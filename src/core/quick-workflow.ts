import path from 'node:path';
import type { Profile } from './types.js';
import { checkOrigin, type OriginCheckResult } from './origin-check.js';
import { WorkflowRunner } from './workflow.js';
import type { StateStore } from '../persistence/store.js';
import type { ProcessSupervisor } from '../providers/process-supervisor.js';

export class QuickTunnelWorkflow {
  private readonly store: StateStore;
  private readonly supervisor: ProcessSupervisor;
  private readonly executable: string;
  private readonly baseArgs: string[];
  private readonly env?: NodeJS.ProcessEnv;
  private readonly originCheck: (url: string) => Promise<OriginCheckResult>;

  constructor(options: { store: StateStore; supervisor: ProcessSupervisor; executable?: string; baseArgs?: string[]; env?: NodeJS.ProcessEnv; originCheck?: (url: string) => Promise<OriginCheckResult> }) {
    this.store = options.store; this.supervisor = options.supervisor; this.executable = options.executable ?? 'cloudflared';
    this.baseArgs = options.baseArgs ?? []; this.env = options.env; this.originCheck = options.originCheck ?? (url => checkOrigin(url));
  }

  async run(input: { projectPath: string; displayName?: string; profile: Profile; localUrl: string }): Promise<any> {
    const project = this.store.saveProject({ displayName: input.displayName ?? path.basename(input.projectPath), path: path.resolve(input.projectPath), profile: input.profile });
    this.store.saveTunnel({ projectId: project.id, kind: 'quick', localUrl: input.localUrl });
    const run = this.store.createWorkflow({ projectId: project.id, kind: 'quick' });
    const runner = new WorkflowRunner(this.store, run.id);
    const origin = await this.originCheck(input.localUrl);
    if (!origin.reachable) {
      runner.fail('origin', origin.error);
      return { state: 'failed', projectId: project.id, runId: run.id, error: origin.error };
    }
    await runner.step('origin', async () => ({ state: origin.warning ? 'warning' : 'succeeded', value: origin, effects: ['Verified the local application is reachable.'] }));
    const sessionKey = `quick:${project.id}`;
    try {
      const session = await this.supervisor.start({ key: sessionKey, executable: this.executable, args: [...this.baseArgs, 'tunnel', '--url', input.localUrl], env: this.env });
      const logs = await session.waitForOutput(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i, 15_000);
      const publicUrl = logs.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i)?.[0];
      if (!publicUrl) throw new Error('Quick Tunnel URL was not received.');
      await runner.step('connector', async () => ({ value: { publicUrl }, effects: [`Started Quick Tunnel at ${publicUrl}.`] }));
      this.store.saveSession({ projectId: project.id, processKey: sessionKey, pid: session.pid, state: 'running', ephemeralUrl: publicUrl, executable: this.executable });
      this.store.completeWorkflow(run.id, 'succeeded');
      return { state: 'succeeded', projectId: project.id, runId: run.id, sessionKey, publicUrl };
    } catch (error) {
      await this.supervisor.stop(sessionKey);
      const safe = { code: 'QUICK_URL_NOT_RECEIVED', reason: error instanceof Error ? error.message : String(error), fix: 'Check cloudflared connectivity and retry.' };
      runner.fail('connector', safe);
      return { state: 'failed', projectId: project.id, runId: run.id, error: safe };
    }
  }

  async stop(projectId: string): Promise<void> {
    const saved = this.store.getLatestSession(projectId);
    await this.supervisor.stop(saved.processKey);
    this.store.stopSession(saved.id);
  }

  async restart(projectId: string): Promise<any> {
    const project = this.store.getProject(projectId); const tunnel = this.store.getTunnelForProject(projectId);
    if (!tunnel?.localUrl) throw new Error('Saved Quick Tunnel settings are incomplete.');
    return this.run({ projectPath: project.path, displayName: project.displayName, profile: project.profile, localUrl: tunnel.localUrl });
  }
}
