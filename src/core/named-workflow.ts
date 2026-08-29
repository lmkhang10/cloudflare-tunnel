import path from 'node:path';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import type { Profile } from './types.js';
import { checkOrigin, type OriginCheckResult } from './origin-check.js';
import { validateTunnelConfig } from './validation.js';
import { WorkflowRunner } from './workflow.js';
import type { StateStore, SavedTunnel } from '../persistence/store.js';
import type { ProcessSupervisor } from '../providers/process-supervisor.js';

interface CloudflarePort {
  version(): Promise<any>; login(): Promise<any>; listTunnels(): Promise<any>; createTunnel(name: string): Promise<any>;
  validateIngress(configPath: string): Promise<any>; routeDns(tunnel: string, hostname: string): Promise<any>; info(tunnel: string): Promise<any>;
}

export class NamedTunnelWorkflow {
  private readonly store: StateStore; private readonly cloudflare: CloudflarePort; private readonly supervisor: ProcessSupervisor;
  private readonly projectsDir: string; private readonly executable: string; private readonly baseArgs: string[]; private readonly env?: NodeJS.ProcessEnv;
  private readonly originCheck: (url: string) => Promise<OriginCheckResult>; private readonly publicCheck: (url: string) => Promise<OriginCheckResult>;

  constructor(options: { store: StateStore; cloudflare: CloudflarePort; supervisor: ProcessSupervisor; projectsDir: string; executable?: string; baseArgs?: string[]; env?: NodeJS.ProcessEnv; originCheck?: (url: string) => Promise<OriginCheckResult>; publicCheck?: (url: string) => Promise<OriginCheckResult> }) {
    this.store = options.store; this.cloudflare = options.cloudflare; this.supervisor = options.supervisor; this.projectsDir = options.projectsDir;
    this.executable = options.executable ?? 'cloudflared'; this.baseArgs = options.baseArgs ?? []; this.env = options.env;
    this.originCheck = options.originCheck ?? (url => checkOrigin(url)); this.publicCheck = options.publicCheck ?? (url => checkOrigin(url, { timeoutMs: 10_000 }));
  }

  async run(input: { projectPath: string; displayName?: string; profile: Profile; localUrl: string; tunnelName: string; hostname: string }): Promise<any> {
    const project = this.store.saveProject({ displayName: input.displayName ?? path.basename(input.projectPath), path: path.resolve(input.projectPath), profile: input.profile });
    return this.execute(project.id, input);
  }

  async retry(projectId: string): Promise<any> {
    const project = this.store.getProject(projectId); const tunnel = this.store.getTunnelForProject(projectId);
    if (!tunnel?.name || !tunnel.hostname || !tunnel.localUrl) throw new Error('Saved named tunnel settings are incomplete.');
    return this.execute(projectId, { projectPath: project.path, displayName: project.displayName, profile: project.profile, localUrl: tunnel.localUrl, tunnelName: tunnel.name, hostname: tunnel.hostname });
  }

  private async execute(projectId: string, input: { projectPath: string; displayName?: string; profile: Profile; localUrl: string; tunnelName: string; hostname: string }): Promise<any> {
    const run = this.store.createWorkflow({ projectId, kind: 'named' }); const runner = new WorkflowRunner(this.store, run.id);
    const validation = validateTunnelConfig({ profile: input.profile, operation: 'create', localUrl: input.localUrl, tunnelName: input.tunnelName, hostname: input.hostname, projectRoot: input.projectPath });
    if (!validation.ok) { runner.fail('input', validation.issues); return { state: 'failed', projectId, runId: run.id, error: validation.issues[0] }; }
    await runner.step('input', async () => ({ value: validation.normalized, effects: ['Validated tunnel settings.'] }));
    const origin = await this.originCheck(input.localUrl);
    if (!origin.reachable) { runner.fail('origin', origin.error); return { state: 'failed', projectId, runId: run.id, error: origin.error }; }
    await runner.step('origin', async () => ({ state: origin.warning ? 'warning' : 'succeeded', value: origin, effects: ['Verified the local application.'] }));
    const version = await this.cloudflare.version();
    if (!version.ok) { runner.fail('environment', version.error); return { state: 'failed', projectId, runId: run.id, error: version.error }; }
    await runner.step('environment', async () => ({ value: version.value, effects: ['Found cloudflared.'] }));
    let listed = await this.cloudflare.listTunnels();
    if (!listed.ok && ['AUTH_REQUIRED', 'AUTH_STALE'].includes(listed.error.code)) {
      const login = await this.cloudflare.login();
      if (!login.ok) { runner.fail('authentication', login.error); return { state: 'failed', projectId, runId: run.id, error: login.error }; }
      await runner.step('authentication', async () => ({ value: login.value, effects: ['Signed in to Cloudflare.'] }));
      listed = await this.cloudflare.listTunnels();
    }
    if (!listed.ok) { runner.fail('account-access', listed.error); return { state: 'failed', projectId, runId: run.id, error: listed.error }; }
    await runner.step('account-access', async () => ({ value: { tunnelCount: listed.value.length }, effects: ['Verified Cloudflare account access.'] }));

    let tunnel: SavedTunnel | undefined = this.store.getTunnelForProject(projectId);
    if (!tunnel?.uuid) {
      const conflict = listed.value.find((item: any) => item.name === input.tunnelName);
      if (conflict) { const error = { code: 'TUNNEL_NAME_CONFLICT', reason: `Tunnel ${input.tunnelName} already exists but is not managed by this local project.`, fix: 'Choose another name or explicitly adopt the existing tunnel.' }; runner.fail('tunnel', error); return { state: 'failed', projectId, runId: run.id, error }; }
      const created = await this.cloudflare.createTunnel(input.tunnelName);
      if (!created.ok) { runner.fail('tunnel', created.error); return { state: 'failed', projectId, runId: run.id, error: created.error }; }
      const configPath = path.join(this.projectsDir, projectId, 'config.yml');
      tunnel = this.store.saveTunnel({ projectId, kind: 'named', name: input.tunnelName, uuid: created.value.uuid, hostname: input.hostname, localUrl: input.localUrl, configPath, credentialsPath: created.value.credentialsFile });
      await runner.step('tunnel', async () => ({ value: { uuid: tunnel!.uuid }, effects: [`Created tunnel ${input.tunnelName} (${tunnel!.uuid}).`] }));
    }
    if (!tunnel.uuid || !tunnel.credentialsPath || !tunnel.configPath) throw new Error('Saved tunnel identity is incomplete.');
    try { const credentialStat = await stat(tunnel.credentialsPath); if (!credentialStat.isFile()) throw new Error(); } catch { const error = { code: 'TUNNEL_CREDENTIALS_MISSING', reason: 'The tunnel credential file is missing.', fix: 'Restore the credential file or create a new tunnel.' }; runner.fail('configuration', error); return { state: 'failed', projectId, runId: run.id, error }; }
    await mkdir(path.dirname(tunnel.configPath), { recursive: true, mode: 0o700 });
    const yaml = `tunnel: ${JSON.stringify(tunnel.uuid)}\ncredentials-file: ${JSON.stringify(tunnel.credentialsPath)}\ningress:\n  - hostname: ${JSON.stringify(input.hostname)}\n    service: ${JSON.stringify(input.localUrl)}\n  - service: http_status:404\n`;
    const temporary = `${tunnel.configPath}.tmp`; await writeFile(temporary, yaml, { mode: 0o600 }); await rename(temporary, tunnel.configPath);
    await runner.step('configuration', async () => ({ value: { configPath: tunnel!.configPath }, effects: ['Wrote application-owned tunnel config outside the repository.'] }));
    const ingress = await this.cloudflare.validateIngress(tunnel.configPath);
    if (!ingress.ok) { runner.fail('ingress-validation', ingress.error); return { state: 'failed', projectId, runId: run.id, error: ingress.error }; }
    await runner.step('ingress-validation', async () => ({ value: ingress.value, effects: ['Validated ingress rules.'] }));
    const routed = await this.cloudflare.routeDns(tunnel.uuid, input.hostname);
    if (!routed.ok) { runner.fail('dns-route', routed.error); return { state: 'failed', projectId, runId: run.id, error: routed.error, configPath: tunnel.configPath }; }
    await runner.step('dns-route', async () => ({ value: routed.value, effects: [`Routed ${input.hostname} to the tunnel.`] }));
    const sessionKey = `named:${tunnel.uuid}`;
    const session = await this.supervisor.start({ key: sessionKey, executable: this.executable, args: [...this.baseArgs, 'tunnel', '--config', tunnel.configPath, 'run', tunnel.uuid], env: this.env });
    await runner.step('connector', async () => ({ value: { pid: session.pid }, effects: ['Started the Cloudflare connector.'] }));
    const info = await this.cloudflare.info(tunnel.uuid);
    await runner.step('cloudflare-health', async () => ({ state: info.ok && info.value.connectorState === 'healthy' ? 'succeeded' : 'warning', value: info.ok ? info.value : info.error, effects: [] }));
    const publicUrl = `https://${input.hostname}`; const publicHealth = await this.publicCheck(publicUrl);
    await runner.step('public-health', async () => ({ state: publicHealth.reachable ? 'succeeded' : 'warning', value: publicHealth, effects: [] }));
    this.store.saveSession({ projectId, processKey: sessionKey, pid: session.pid, state: 'running', executable: this.executable });
    this.store.completeWorkflow(run.id, 'succeeded');
    return { state: 'succeeded', projectId, runId: run.id, publicUrl, configPath: tunnel.configPath, sessionKey, tunnelUuid: tunnel.uuid };
  }

  async stop(projectId: string): Promise<void> { const session = this.store.getLatestSession(projectId); await this.supervisor.stop(session.processKey); this.store.stopSession(session.id); }
}
