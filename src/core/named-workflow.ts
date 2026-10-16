import path from 'node:path';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { Profile } from './types.js';
import { checkOrigin, type OriginCheckResult } from './origin-check.js';
import { validateTunnelConfig } from './validation.js';
import { readCredentialsTunnelId } from '../providers/origin-cert.js';
import { WorkflowRunner } from './workflow.js';
import type { StateStore, SavedTunnel } from '../persistence/store.js';
import type { ProcessSupervisor } from '../providers/process-supervisor.js';
import type { DnsCleanupPort, DnsCleanupResult } from '../providers/cloudflare-dns.js';

export interface CloudflarePort {
  version(): Promise<any>; listTunnels(): Promise<any>; createTunnel(name: string, options?: { credentialsFile?: string }): Promise<any>;
  validateIngress(configPath: string): Promise<any>; routeDns(tunnel: string, hostname: string, options?: { overwrite?: boolean }): Promise<any>; info(tunnel: string): Promise<any>;
  deleteTunnel?(tunnel: string): Promise<any>;
}

type NamedInput = { projectPath: string; displayName?: string; profile: Profile; localUrl: string; tunnelName: string; hostname: string; accountId?: string; replaceDns?: boolean; replaceTunnel?: boolean };

export class NamedTunnelWorkflow {
  private readonly store: StateStore; private readonly cloudflareFor: (accountId?: string) => CloudflarePort; private readonly supervisor: ProcessSupervisor;
  private readonly projectsDir: string; private readonly executable: () => string; private readonly baseArgs: string[]; private readonly runArgs: () => string[]; private readonly env?: NodeJS.ProcessEnv;
  private readonly credentialsFileFor: (accountId: string | undefined, tunnelName: string) => string | undefined;
  private readonly dnsFor: (accountId?: string) => DnsCleanupPort;
  private readonly originCheck: (url: string) => Promise<OriginCheckResult>; private readonly publicCheck: (url: string) => Promise<OriginCheckResult>;

  /**
   * `cloudflareFor` returns an adapter bound to one Cloudflare account; `cloudflare` is a single-account shortcut.
   * `runArgs` supplies extra `cloudflared tunnel` flags (protocol, log level) read at start time.
   */
  constructor(options: { store: StateStore; cloudflare?: CloudflarePort; cloudflareFor?: (accountId?: string) => CloudflarePort; supervisor: ProcessSupervisor; projectsDir: string; executable?: string | (() => string); baseArgs?: string[]; runArgs?: () => string[]; env?: NodeJS.ProcessEnv; credentialsFileFor?: (accountId: string | undefined, tunnelName: string) => string | undefined; dnsFor?: (accountId?: string) => DnsCleanupPort; originCheck?: (url: string) => Promise<OriginCheckResult>; publicCheck?: (url: string) => Promise<OriginCheckResult> }) {
    const single = options.cloudflare;
    if (!options.cloudflareFor && !single) throw new Error('A Cloudflare adapter is required.');
    this.store = options.store; this.cloudflareFor = options.cloudflareFor ?? (() => single!); this.supervisor = options.supervisor; this.projectsDir = options.projectsDir;
    const executable = options.executable ?? 'cloudflared'; this.executable = typeof executable === 'function' ? executable : () => executable;
    this.baseArgs = options.baseArgs ?? []; this.runArgs = options.runArgs ?? (() => []); this.env = options.env;
    this.credentialsFileFor = options.credentialsFileFor ?? (() => undefined);
    this.dnsFor = options.dnsFor ?? (() => ({ deleteTunnelRecord: async (hostname: string) => ({ state: 'skipped', detail: `DNS cleanup is not available, so the record for ${hostname} was kept.` }) }));
    this.originCheck = options.originCheck ?? (url => checkOrigin(url)); this.publicCheck = options.publicCheck ?? (url => checkOrigin(url, { timeoutMs: 10_000, tcpFallback: false }));
  }

  async run(input: NamedInput): Promise<any> {
    const validation = validateTunnelConfig({ profile: input.profile, operation: 'create', localUrl: input.localUrl, tunnelName: input.tunnelName, hostname: input.hostname, projectRoot: input.projectPath });
    if (!validation.ok) return { state: 'failed', error: validation.issues[0], issues: validation.issues };
    const project = this.store.saveProject({ displayName: input.displayName ?? path.basename(input.projectPath), path: path.resolve(input.projectPath), profile: input.profile });
    return this.execute(project.id, input);
  }

  async retry(projectId: string, options: { replaceDns?: boolean; replaceTunnel?: boolean } = {}): Promise<any> {
    const project = this.store.getProject(projectId); const tunnel = this.store.getTunnelForProject(projectId);
    if (!tunnel?.name || !tunnel.hostname || !tunnel.localUrl) throw new Error('This custom-domain setup never finished, so there is no tunnel to start. Remove the project and create it again from New tunnel → Custom domain.');
    return this.execute(projectId, { projectPath: project.path, displayName: project.displayName, profile: project.profile, localUrl: tunnel.localUrl, tunnelName: tunnel.name, hostname: tunnel.hostname, accountId: tunnel.accountId, replaceDns: options.replaceDns, replaceTunnel: options.replaceTunnel });
  }

  private async execute(projectId: string, input: NamedInput): Promise<any> {
    const run = this.store.createWorkflow({ projectId, kind: 'named' }); const runner = new WorkflowRunner(this.store, run.id);
    const validation = validateTunnelConfig({ profile: input.profile, operation: 'create', localUrl: input.localUrl, tunnelName: input.tunnelName, hostname: input.hostname, projectRoot: input.projectPath });
    if (!validation.ok) { runner.fail('input', validation.issues); return { state: 'failed', projectId, runId: run.id, error: validation.issues[0] }; }
    await runner.step('input', async () => ({ value: validation.normalized, effects: ['Validated tunnel settings.'] }));
    const origin = await this.originCheck(input.localUrl);
    if (!origin.reachable) { runner.fail('origin', origin.error); return { state: 'failed', projectId, runId: run.id, error: origin.error }; }
    await runner.step('origin', async () => ({ state: origin.warning ? 'warning' : 'succeeded', value: origin, effects: ['Verified the local application.'] }));
    const existing = this.store.getTunnelForProject(projectId);
    // A tunnel that already exists stays in its account; the account only applies when a new tunnel is created.
    const accountId = existing?.uuid ? existing.accountId : input.accountId;
    const cloudflare = this.cloudflareFor(accountId);
    const version = await cloudflare.version();
    if (!version.ok) { runner.fail('environment', version.error); return { state: 'failed', projectId, runId: run.id, error: version.error }; }
    await runner.step('environment', async () => ({ value: version.value, effects: ['Found cloudflared.'] }));
    const listed = await cloudflare.listTunnels();
    // Signing in is an explicit account action now, so a workflow never overwrites a certificate behind the user's back.
    if (!listed.ok && ['AUTH_REQUIRED', 'AUTH_STALE'].includes(listed.error.code)) { runner.fail('authentication', listed.error); return { state: 'failed', projectId, runId: run.id, accountId, error: listed.error }; }
    if (!listed.ok) { runner.fail('account-access', listed.error); return { state: 'failed', projectId, runId: run.id, error: listed.error }; }
    await runner.step('account-access', async () => ({ value: { tunnelCount: listed.value.length }, effects: ['Verified Cloudflare account access.'] }));

    let tunnel: SavedTunnel | undefined = existing;
    if (!tunnel?.uuid) {
      // Remember the requested settings before anything can fail, so Retry and Edit work on an unfinished setup.
      tunnel = this.store.saveTunnel({ ...(tunnel ?? {}), projectId, kind: 'named', name: input.tunnelName, hostname: input.hostname, localUrl: input.localUrl, accountId });
      let conflict = listed.value.find((item: any) => item.name === input.tunnelName);
      // A leftover tunnel with this name (for example from a project removed earlier) is replaced only when the user asks.
      if (conflict && input.replaceTunnel && !this.store.listTunnels().some(item => item.uuid === conflict.uuid && item.projectId !== projectId)) {
        await this.dnsFor(accountId).deleteTunnelRecord(input.hostname, conflict.uuid);
        const removed = await cloudflare.deleteTunnel?.(conflict.uuid);
        if (!removed?.ok) { const error = removed?.error ?? { code: 'TUNNEL_DELETE_UNAVAILABLE', reason: 'Deleting tunnels is not available.', fix: 'Delete the old tunnel in the Cloudflare dashboard.' }; runner.fail('tunnel', error); return { state: 'failed', projectId, runId: run.id, error }; }
        conflict = undefined;
      }
      if (conflict) { const error = { code: 'TUNNEL_NAME_CONFLICT', reason: `Tunnel ${input.tunnelName} already exists but is not managed by this local project.`, fix: 'Replace the old tunnel (this deletes it in Cloudflare) or choose another tunnel name with Edit.' }; runner.fail('tunnel', error); return { state: 'failed', projectId, runId: run.id, error }; }
      const credentialsFile = this.credentialsFileFor(accountId, input.tunnelName);
      if (credentialsFile) await mkdir(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
      const created = await cloudflare.createTunnel(input.tunnelName, credentialsFile ? { credentialsFile } : undefined);
      if (!created.ok) { runner.fail('tunnel', created.error); return { state: 'failed', projectId, runId: run.id, error: created.error }; }
      const configPath = path.join(this.projectsDir, projectId, 'config.yml');
      tunnel = this.store.saveTunnel({ projectId, kind: 'named', name: input.tunnelName, uuid: created.value.uuid, hostname: input.hostname, localUrl: input.localUrl, configPath, credentialsPath: created.value.credentialsFile, accountId });
      await runner.step('tunnel', async () => ({ value: { uuid: tunnel!.uuid }, effects: [`Created tunnel ${input.tunnelName} (${tunnel!.uuid}).`] }));
    }
    if (!tunnel.uuid || !tunnel.credentialsPath || !tunnel.configPath) throw new Error('Saved tunnel identity is incomplete.');
    // Repairs ids saved by 0.2.0, which could record the account folder's UUID instead of the tunnel's.
    const recordedId = readCredentialsTunnelId(tunnel.credentialsPath);
    if (recordedId && recordedId !== tunnel.uuid.toLowerCase()) tunnel = this.store.saveTunnel({ ...tunnel, uuid: recordedId });
    if (!tunnel.uuid || !tunnel.credentialsPath || !tunnel.configPath) throw new Error('Saved tunnel identity is incomplete.');
    if (tunnel.hostname !== input.hostname || tunnel.localUrl !== input.localUrl || tunnel.name !== input.tunnelName) {
      tunnel = this.store.saveTunnel({ ...tunnel, hostname: input.hostname, localUrl: input.localUrl, name: input.tunnelName });
      if (!tunnel.uuid || !tunnel.credentialsPath || !tunnel.configPath) throw new Error('Saved tunnel identity is incomplete.');
    }
    try { const credentialStat = await stat(tunnel.credentialsPath); if (!credentialStat.isFile()) throw new Error(); } catch { const error = { code: 'TUNNEL_CREDENTIALS_MISSING', reason: 'The tunnel credential file is missing.', fix: 'Restore the credential file or create a new tunnel.' }; runner.fail('configuration', error); return { state: 'failed', projectId, runId: run.id, error }; }
    await mkdir(path.dirname(tunnel.configPath), { recursive: true, mode: 0o700 });
    const yaml = `tunnel: ${JSON.stringify(tunnel.uuid)}\ncredentials-file: ${JSON.stringify(tunnel.credentialsPath)}\ningress:\n  - hostname: ${JSON.stringify(input.hostname)}\n    service: ${JSON.stringify(input.localUrl)}\n  - service: http_status:404\n`;
    const temporary = `${tunnel.configPath}.tmp`; await writeFile(temporary, yaml, { mode: 0o600 }); await rename(temporary, tunnel.configPath);
    await runner.step('configuration', async () => ({ value: { configPath: tunnel!.configPath }, effects: ['Wrote application-owned tunnel config outside the repository.'] }));
    const ingress = await cloudflare.validateIngress(tunnel.configPath);
    if (!ingress.ok) { runner.fail('ingress-validation', ingress.error); return { state: 'failed', projectId, runId: run.id, error: ingress.error }; }
    await runner.step('ingress-validation', async () => ({ value: ingress.value, effects: ['Validated ingress rules.'] }));
    const routed = await cloudflare.routeDns(tunnel.uuid, input.hostname, input.replaceDns ? { overwrite: true } : undefined);
    if (!routed.ok) { runner.fail('dns-route', routed.error); return { state: 'failed', projectId, runId: run.id, error: routed.error, configPath: tunnel.configPath }; }
    await runner.step('dns-route', async () => ({ value: routed.value, effects: [`Routed ${input.hostname} to the tunnel.`] }));
    const sessionKey = `named:${tunnel.uuid}`;
    let session;
    try { session = await this.supervisor.start({ key: sessionKey, executable: this.executable(), args: [...this.baseArgs, 'tunnel', ...this.runArgs(), '--config', tunnel.configPath, 'run', tunnel.uuid], env: this.env }); }
    catch (cause) { const error = { code: 'CONNECTOR_START_FAILED', reason: cause instanceof Error ? cause.message : String(cause), fix: 'Stop any running connector for this project, check that cloudflared is installed, and retry.' }; runner.fail('connector', error); return { state: 'failed', projectId, runId: run.id, error, configPath: tunnel.configPath }; }
    await runner.step('connector', async () => ({ value: { pid: session.pid }, effects: ['Started the Cloudflare connector.'] }));
    const info = await cloudflare.info(tunnel.uuid);
    await runner.step('cloudflare-health', async () => ({ state: info.ok && info.value.connectorState === 'healthy' ? 'succeeded' : 'warning', value: info.ok ? info.value : info.error, effects: [] }));
    const publicUrl = `https://${input.hostname}`; const publicHealth = await this.publicCheck(publicUrl);
    await runner.step('public-health', async () => ({ state: publicHealth.reachable ? 'succeeded' : 'warning', value: publicHealth, effects: [] }));
    this.store.saveSession({ projectId, processKey: sessionKey, pid: session.pid, state: 'running', executable: this.executable() });
    this.store.completeWorkflow(run.id, 'succeeded');
    return { state: 'succeeded', projectId, runId: run.id, publicUrl, configPath: tunnel.configPath, sessionKey, tunnelUuid: tunnel.uuid };
  }

  /** Deletes the DNS record (only if it points at this tunnel) and then the tunnel itself. Local records are left to the caller. */
  async removeResources(projectId: string): Promise<{ state: 'succeeded' | 'failed'; dns?: DnsCleanupResult; tunnelDeleted: boolean; error?: any }> {
    const tunnel = this.store.getTunnelForProject(projectId);
    if (!tunnel?.uuid) return { state: 'succeeded', tunnelDeleted: false };
    const dns = tunnel.hostname ? await this.deleteDnsRecord(tunnel.accountId, tunnel.hostname, tunnel.uuid) : undefined;
    const cloudflare = this.cloudflareFor(tunnel.accountId);
    const removed = await cloudflare.deleteTunnel?.(tunnel.uuid);
    if (!removed?.ok) return { state: 'failed', dns, tunnelDeleted: false, error: removed?.error ?? { code: 'TUNNEL_DELETE_UNAVAILABLE', reason: 'Deleting tunnels is not available.', fix: 'Delete the tunnel in the Cloudflare dashboard.' } };
    if (tunnel.credentialsPath) await rm(tunnel.credentialsPath, { force: true });
    const configDir = tunnel.configPath ? path.dirname(tunnel.configPath) : undefined;
    if (configDir && path.dirname(configDir) === path.resolve(this.projectsDir)) await rm(configDir, { recursive: true, force: true });
    return { state: 'succeeded', dns, tunnelDeleted: true };
  }

  deleteDnsRecord(accountId: string | undefined, hostname: string, tunnelUuid: string): Promise<DnsCleanupResult> {
    return this.dnsFor(accountId).deleteTunnelRecord(hostname, tunnelUuid).catch((error: unknown) => ({ state: 'failed' as const, detail: `Could not delete the DNS record for ${hostname}: ${error instanceof Error ? error.message : String(error)}` }));
  }

  async stop(projectId: string): Promise<void> { const session = this.store.getLatestSession(projectId); await this.supervisor.stop(session.processKey); this.store.stopSession(session.id); }
}
