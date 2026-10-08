import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { appPathsFor, resolveAppPaths } from './paths.js';
import { openStateDatabase } from '../persistence/database.js';
import { StateStore } from '../persistence/store.js';
import { ProcessSupervisor } from '../providers/process-supervisor.js';
import { CloudflaredAdapter } from '../providers/cloudflared.js';
import { QuickTunnelWorkflow } from '../core/quick-workflow.js';
import { NamedTunnelWorkflow } from '../core/named-workflow.js';
import { AccountService } from './accounts.js';
import { ActivityFeed } from './activity.js';
import { resolveSettings, validateSettingsPatch, settingDefinitions, defaultSettings, type AppSettings } from './settings.js';
import { createAutostartBackend, type AutostartBackend } from '../providers/autostart/index.js';
import { findExecutable } from '../providers/executables.js';
import { UpdateService } from './updates.js';
import { validateTunnelConfig } from '../core/validation.js';

const PLAN_TTL_MS = 10 * 60_000;

interface PreparedPlan { id: string; kind: 'quick' | 'named'; input: any; effects: string[]; confirmations: string[]; createdAt: number; }
/** Where the running CLI lives; used to register launch-at-login and to verify updates. */
export interface RuntimeInfo { nodePath: string; cliPath: string; logsDir: string; env?: Record<string, string>; }

export class TunnelKitService {
  private readonly plans = new Map<string, PreparedPlan>();
  private readonly store: any; private readonly supervisor: any; private readonly quickWorkflow: any; private readonly namedWorkflow: any; private readonly cloudflare: any;
  readonly accounts?: AccountService; readonly autostart?: AutostartBackend; readonly updates?: UpdateService; readonly feed: ActivityFeed = new ActivityFeed();
  private readonly runtime?: RuntimeInfo; private readonly cloudflaredExecutable?: string;
  private activeWorkflows = 0;
  private readonly starting = new Set<string>();
  constructor(options: { store: any; supervisor: any; quickWorkflow: any; namedWorkflow: any; cloudflare: any; database?: Database.Database; accounts?: AccountService; autostart?: AutostartBackend; updates?: UpdateService; feed?: ActivityFeed; runtime?: RuntimeInfo; cloudflaredExecutable?: string }) {
    Object.assign(this, options); this.database = options.database;
  }
  private readonly database?: Database.Database;

  get busy(): boolean { return this.activeWorkflows > 0; }

  getSettings(): AppSettings { return typeof this.store?.getSettings === 'function' ? resolveSettings(this.store.getSettings()) : { ...defaultSettings }; }
  settingsView(): { values: AppSettings; definitions: typeof settingDefinitions } { return { values: this.getSettings(), definitions: settingDefinitions }; }
  updateSettings(patch: unknown): { values: AppSettings; definitions: typeof settingDefinitions } {
    const values = validateSettingsPatch(patch);
    if (values.defaultAccountId) this.store.getAccount(values.defaultAccountId);
    if (values.cloudflaredPath && !findExecutable(values.cloudflaredPath)) throw new Error('cloudflared was not found at that path, or it is not executable.');
    this.store.saveSettings(values); return this.settingsView();
  }

  /** The cloudflared binary to run: explicit option, then the settings override, then PATH. */
  executable(): string { return this.cloudflaredExecutable ?? (this.getSettings().cloudflaredPath || 'cloudflared'); }
  connectorArgs(kind: 'quick' | 'named'): string[] {
    const settings = this.getSettings();
    // Quick Tunnels announce their URL at info level, so a quieter level would hide it.
    return [...(settings.noAutoupdate ? ['--no-autoupdate'] : []), ...(settings.protocol !== 'auto' ? ['--protocol', settings.protocol] : []), ...(kind === 'named' ? ['--loglevel', settings.logLevel] : [])];
  }

  async listProjects(): Promise<any[]> {
    const labels = new Map<string, string>((this.accounts ? this.store.listAccounts() : []).map((account: any) => [account.id, account.label]));
    return this.store.listProjects().map((project: any) => {
      const tunnel = this.store.getTunnelForProject(project.id);
      let session: any; try { session = this.store.getLatestSession(project.id); } catch {}
      const observed = session ? this.supervisor.status(session.processKey) : { state: 'stopped', logs: '' };
      const status = this.starting.has(project.id) ? 'Starting' : !existsSync(project.path) ? 'Needs attention' : observed.state === 'running' ? 'Running' : 'Stopped';
      return { ...project, status, kind: tunnel?.kind, hostname: tunnel?.hostname, localUrl: tunnel?.localUrl, publicUrl: session?.ephemeralUrlExpired ? undefined : session?.ephemeralUrl ?? (observed.state === 'running' && tunnel?.hostname ? `https://${tunnel.hostname}` : undefined), processState: observed.state, accountId: tunnel?.accountId, accountLabel: tunnel?.accountId ? labels.get(tunnel.accountId) : undefined, hasTunnel: Boolean(tunnel?.uuid) };
    });
  }

  async getProject(id: string): Promise<any> {
    const project = this.store.getProject(id); const tunnel = this.store.getTunnelForProject(id);
    let session; try { session = this.store.getLatestSession(id); } catch {}
    const observed = session ? this.supervisor.status(session.processKey) : { state: 'stopped', logs: '' };
    return { ...project, tunnel, session, health: { localProcess: observed.state, cloudflareConnector: 'unknown', publicHostname: 'unchecked' }, logs: observed.logs };
  }

  async prepareQuick(input: any): Promise<PreparedPlan> {
    input = this.checkInput('quick', input);
    return this.savePlan('quick', input, [`Start a temporary Quick Tunnel to ${input.localUrl}.`], ['start-connector']);
  }
  async prepareNamed(input: any): Promise<PreparedPlan> {
    input = this.checkInput('named', input);
    const accountId = input.accountId || this.getSettings().defaultAccountId || undefined;
    const account = accountId && this.accounts ? this.store.getAccount(accountId) : undefined;
    const where = account ? ` in Cloudflare account ${account.label}` : '';
    return this.savePlan('named', { ...input, accountId }, [`Create or reuse tunnel ${input.tunnelName}${where}.`, `Create DNS route ${input.hostname}.`, `Start a connector to ${input.localUrl}.`], ['cloudflare-resources', 'start-connector']);
  }
  /** Rejects invalid settings before the review step, so a failed run never leaves a half-created project behind. */
  private checkInput(kind: 'quick' | 'named', raw: any): any {
    const input = { ...raw, localUrl: String(raw?.localUrl ?? '').trim(), tunnelName: typeof raw?.tunnelName === 'string' ? raw.tunnelName.trim().toLowerCase() : raw?.tunnelName, hostname: typeof raw?.hostname === 'string' ? raw.hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '') : raw?.hostname };
    const issues = [];
    if (!String(input.projectPath ?? '').trim()) issues.push({ code: 'INPUT_PROJECT_PATH_REQUIRED', field: 'projectPath', reason: 'A project folder is required.', fix: 'Enter the folder of the local project.' });
    const validation = validateTunnelConfig({ profile: input.profile ?? 'custom', operation: kind === 'named' ? 'create' : 'quick', localUrl: input.localUrl, tunnelName: input.tunnelName, hostname: input.hostname, projectRoot: input.projectPath });
    issues.push(...validation.issues);
    if (issues.length) throw Object.assign(new Error(`${issues[0].reason} ${issues[0].fix}`), { issues });
    return input;
  }

  private savePlan(kind: 'quick' | 'named', input: any, effects: string[], confirmations: string[]): PreparedPlan {
    for (const [id, saved] of this.plans) if (Date.now() - saved.createdAt > PLAN_TTL_MS) this.plans.delete(id);
    const plan = { id: crypto.randomUUID(), kind, input, effects, confirmations, createdAt: Date.now() }; this.plans.set(plan.id, plan); return plan;
  }

  async execute(id: string, confirmations: string[]): Promise<any> {
    const plan = this.plans.get(id); if (!plan) throw new Error('Plan not found or expired.');
    if (Date.now() - plan.createdAt > PLAN_TTL_MS) { this.plans.delete(id); throw new Error('Plan expired. Review the settings again.'); }
    if (!Array.isArray(confirmations)) throw new Error('Confirmations must be a list of confirmed operations.');
    const missing = plan.confirmations.filter(item => !confirmations.includes(item));
    if (missing.length) throw new Error(`Confirmation required for: ${missing.join(', ')}`);
    this.plans.delete(id);
    return this.track(plan.kind, () => plan.kind === 'quick' ? this.quickWorkflow.run(plan.input) : this.namedWorkflow.run(plan.input));
  }

  async retry(projectId: string): Promise<any> {
    const tunnel = this.store.getTunnelForProject(projectId); const kind = tunnel?.kind === 'named' ? 'named' : 'quick';
    this.starting.add(projectId);
    try { return await this.track(kind, () => kind === 'named' ? this.namedWorkflow.retry(projectId) : this.quickWorkflow.restart(projectId)); }
    finally { this.starting.delete(projectId); }
  }
  async stop(projectId: string): Promise<void> { const tunnel = this.store.getTunnelForProject(projectId); return tunnel?.kind === 'named' ? this.namedWorkflow.stop(projectId) : this.quickWorkflow.stop(projectId); }
  async start(projectId: string): Promise<any> { return this.retry(projectId); }
  /** Points the hostname at this project's tunnel even when another DNS record exists. Only called after the user confirms. */
  async replaceDns(projectId: string): Promise<any> {
    const tunnel = this.store.getTunnelForProject(projectId);
    if (tunnel?.kind !== 'named') throw new Error('Only custom-domain projects have a DNS record.');
    return this.track('named', () => this.namedWorkflow.retry(projectId, { replaceDns: true }));
  }
  async restart(projectId: string): Promise<any> { try { await this.stop(projectId); } catch {} return this.start(projectId); }

  private async track(kind: 'quick' | 'named', operation: () => Promise<any>): Promise<any> {
    this.activeWorkflows++;
    try {
      const result = await operation();
      if (kind === 'quick' && result?.state === 'succeeded' && result.publicUrl) this.feed.push({ type: 'quick-url', title: 'Quick Tunnel is live', message: result.publicUrl, projectId: result.projectId, notify: this.getSettings().notifyOnQuickUrl });
      return result;
    } finally { this.activeWorkflows--; }
  }

  runningProjectIds(): string[] { return this.store.listProjects().filter((project: any) => { try { return this.supervisor.status(this.store.getLatestSession(project.id).processKey).state === 'running'; } catch { return false; } }).map((project: any) => project.id); }
  async startAll(): Promise<any[]> { const running = new Set(this.runningProjectIds()); const results = []; for (const project of this.store.listProjects()) if (!running.has(project.id)) results.push({ projectId: project.id, result: await this.start(project.id).catch((error: Error) => ({ state: 'failed', error: { reason: error.message } })) }); return results; }
  async stopAll(): Promise<void> { for (const id of this.runningProjectIds()) await this.stop(id).catch(() => undefined); await this.supervisor.stopAll?.(); }

  /** Sessions recorded as running by a previous process are closed, since that process took its connectors with it. */
  reconcileSessions(): number {
    let closed = 0;
    for (const session of this.store.listOpenSessions()) if (this.supervisor.status(session.processKey).state !== 'running') { this.store.stopSession(session.id); closed++; }
    return closed;
  }

  async updateProjectSettings(projectId: string, input: { autoStart?: unknown; accountId?: unknown; confirmNewTunnel?: unknown }): Promise<any> {
    this.store.getProject(projectId);
    if (input.autoStart !== undefined) { if (typeof input.autoStart !== 'boolean') throw new Error('autoStart must be true or false.'); this.store.setProjectAutoStart(projectId, input.autoStart); }
    if (input.accountId !== undefined) {
      const accountId = input.accountId === '' || input.accountId === null ? undefined : String(input.accountId);
      if (accountId) this.store.getAccount(accountId);
      const tunnel = this.store.getTunnelForProject(projectId);
      if (!tunnel || tunnel.kind !== 'named') throw new Error('Only custom-domain projects use a Cloudflare account.');
      if ((tunnel.accountId ?? undefined) !== accountId) {
        if (this.runningProjectIds().includes(projectId)) throw new Error('Stop the connector before moving this project to another account.');
        // A tunnel belongs to one account, so switching means the next start creates a new tunnel there.
        if (tunnel.uuid && input.confirmNewTunnel !== true) throw new Error('This project already has a tunnel in its current account. Confirm that a new tunnel and DNS route should be created in the selected account.');
        this.store.saveTunnel({ ...tunnel, accountId, uuid: undefined, credentialsPath: undefined });
      }
    }
    return (await this.listProjects()).find(project => project.id === projectId);
  }

  async relinkProject(projectId: string, nextPath: string): Promise<void> {
    if (!nextPath?.trim()) throw new Error('A new project folder is required.');
    let resolved: string;
    try { resolved = realpathSync(nextPath); } catch { throw new Error('The new project path must be an existing project directory.'); }
    if (!statSync(resolved).isDirectory()) throw new Error('The new project path must be an existing project directory.');
    const duplicate = this.store.listProjects().find((project: any) => project.path === resolved && project.id !== projectId);
    if (duplicate) throw new Error('Another local project already uses this folder.');
    this.store.relinkProject(projectId, resolved);
  }
  async removeLocal(projectId: string): Promise<void> {
    let session; try { session = this.store.getLatestSession(projectId); } catch {}
    if (session && this.supervisor.status(session.processKey).state === 'running') throw new Error('Stop the connector before removing this project from the local dashboard.');
    this.store.removeProject(projectId);
  }
  async prepareCloudflareCleanup(projectId: string): Promise<any> {
    const tunnel = this.store.getTunnelForProject(projectId); return { enabled: false, code: 'CLOUDFLARE_CLEANUP_NOT_ENABLED', resources: tunnel ? { tunnelUuid: tunnel.uuid, hostname: tunnel.hostname, configPath: tunnel.configPath } : {}, message: 'Cloudflare resource deletion is not enabled in this release. Remove resources explicitly in the Cloudflare dashboard.' };
  }

  listAccounts(): any { return { accounts: this.requireAccounts().list(this.getSettings().defaultAccountId), defaultAccountId: this.getSettings().defaultAccountId || undefined }; }
  discoverAccounts(): any { return { candidates: this.requireAccounts().discover() }; }
  importAccount(input: { candidateId?: unknown; label?: unknown }): any {
    if (typeof input.candidateId !== 'string') throw new Error('Choose a certificate to import.');
    const account = this.requireAccounts().importCandidate(input.candidateId, typeof input.label === 'string' ? input.label : undefined);
    if (!this.getSettings().defaultAccountId) this.store.saveSettings({ defaultAccountId: account.id });
    return account;
  }
  startAccountLogin(input: { label?: unknown; accountId?: unknown }): any { return this.requireAccounts().startLogin({ label: typeof input.label === 'string' ? input.label : undefined, accountId: typeof input.accountId === 'string' ? input.accountId : undefined }); }
  getAccountLogin(jobId: string): any {
    const job = this.requireAccounts().getLogin(jobId);
    if (job.state === 'succeeded' && job.accountId && !this.getSettings().defaultAccountId) this.store.saveSettings({ defaultAccountId: job.accountId });
    return job;
  }
  verifyAccount(id: string): Promise<any> { return this.requireAccounts().verify(id); }
  renameAccount(id: string, label: unknown): any { if (typeof label !== 'string') throw new Error('A label is required.'); return this.requireAccounts().rename(id, label); }
  removeAccount(id: string): void { this.requireAccounts().remove(id); if (this.getSettings().defaultAccountId === id) this.store.saveSettings({ defaultAccountId: '' }); }
  setDefaultAccount(id: string): any { this.store.getAccount(id); this.store.saveSettings({ defaultAccountId: id }); return this.listAccounts(); }
  private requireAccounts(): AccountService { if (!this.accounts) throw new Error('Account management is not available.'); return this.accounts; }

  async autostartStatus(): Promise<any> { return this.autostart ? this.autostart.status() : { supported: false, enabled: false, loaded: false, stale: false, detail: 'Launch at login is not available.' }; }
  async setAutostart(enabled: unknown): Promise<any> {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be true or false.');
    if (!this.autostart || !this.runtime) throw new Error('Launch at login is not available.');
    if (!enabled) return this.autostart.disable();
    const cloudflared = findExecutable(this.executable());
    const pathEnv = [...new Set([cloudflared && path.dirname(cloudflared), path.dirname(this.runtime.nodePath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean) as string[])].join(path.delimiter);
    return this.autostart.enable({ nodePath: this.runtime.nodePath, cliPath: this.runtime.cliPath, logDir: this.runtime.logsDir, pathEnv, env: this.runtime.env });
  }

  updateStatus(): any { return this.updates?.snapshot() ?? { available: false, installKind: 'unknown', cloudflared: { available: false } }; }
  async checkForUpdates(): Promise<any> {
    if (!this.updates) throw new Error('Update checks are not available.');
    const before = this.updates.snapshot().latest;
    const state = await this.updates.check();
    if (state.available && state.latest !== before) this.feed.push({ type: 'update-available', title: `cftunnel ${state.latest} is available`, message: state.installKind === 'global' ? 'Install it from the menu bar or Settings → Updates.' : `Update with: ${state.installCommand}`, notify: true });
    return state;
  }

  listEvents(after = 0): any { return this.feed.list(after); }

  async doctor(): Promise<any> {
    const version = await this.cloudflare.version();
    const checks: any[] = [{ name: 'Node.js', state: 'passed', detail: process.version }, { name: 'cloudflared', state: version.ok ? 'passed' : 'failed', detail: version.ok ? version.value.version : version.error.summary }];
    if (this.accounts) { const count = this.store.listAccounts().length; checks.push({ name: 'Cloudflare accounts', state: count ? 'passed' : 'warning', detail: count ? `${count} connected` : 'None connected yet. Custom domains need one; Quick Tunnels do not.' }); }
    if (this.autostart) { const status = await this.autostart.status(); checks.push({ name: 'Launch at login', state: status.stale ? 'warning' : status.enabled ? 'passed' : 'skipped', detail: status.detail }); }
    return { ok: version.ok, checks };
  }
  close(): void { this.database?.close(); }
}

export function createTunnelKitService(options: { dataDir?: string; cloudflaredExecutable?: string; runtime?: Omit<RuntimeInfo, 'logsDir'>; version?: string; packageName?: string } = {}): TunnelKitService {
  const paths = options.dataDir ? appPathsFor(options.dataDir) : resolveAppPaths();
  const database = openStateDatabase(paths.database); const store = new StateStore(database); const supervisor = new ProcessSupervisor();
  let service: TunnelKitService | undefined;
  const executable = () => service?.executable() ?? options.cloudflaredExecutable ?? 'cloudflared';
  const adapter = (originCert?: string) => new CloudflaredAdapter({ executable: executable(), originCert });
  const accounts = new AccountService({ store, accountsDir: paths.accountsDir, cloudflaredHome: path.join(os.homedir(), '.cloudflared'), adapterFor: adapter });
  const cloudflare = { version: () => adapter().version() };
  const quickWorkflow = new QuickTunnelWorkflow({ store, supervisor, executable, runArgs: () => service?.connectorArgs('quick') ?? [] });
  const namedWorkflow = new NamedTunnelWorkflow({
    store, supervisor, projectsDir: paths.projectsDir, executable, runArgs: () => service?.connectorArgs('named') ?? [],
    cloudflareFor: accountId => adapter(accounts.certPathFor(accountId)),
    credentialsFileFor: (accountId, tunnelName) => accounts.credentialsFileFor(accountId, tunnelName),
  });
  const runtime = options.runtime ? { ...options.runtime, logsDir: paths.logsDir } : undefined;
  const updates = runtime && options.version ? new UpdateService({
    packageName: options.packageName ?? 'cloudflare-tunnel-kit', currentVersion: options.version, nodePath: runtime.nodePath, cliPath: runtime.cliPath,
    cloudflared: async () => { const found = findExecutable(executable()); const result = await adapter().version(); return { version: result.ok ? result.value.version : undefined, path: found }; },
  }) : undefined;
  service = new TunnelKitService({ store, supervisor, quickWorkflow, namedWorkflow, cloudflare, database, accounts, autostart: createAutostartBackend(), updates, runtime, cloudflaredExecutable: options.cloudflaredExecutable });
  return service;
}
