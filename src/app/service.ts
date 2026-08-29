import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { resolveAppPaths } from './paths.js';
import { openStateDatabase } from '../persistence/database.js';
import { StateStore } from '../persistence/store.js';
import { ProcessSupervisor } from '../providers/process-supervisor.js';
import { CloudflaredAdapter } from '../providers/cloudflared.js';
import { QuickTunnelWorkflow } from '../core/quick-workflow.js';
import { NamedTunnelWorkflow } from '../core/named-workflow.js';

interface PreparedPlan { id: string; kind: 'quick' | 'named'; input: any; effects: string[]; confirmations: string[]; createdAt: number; }

export class TunnelKitService {
  private readonly plans = new Map<string, PreparedPlan>();
  private readonly store: any; private readonly supervisor: any; private readonly quickWorkflow: any; private readonly namedWorkflow: any; private readonly cloudflare: any;
  constructor(options: { store: any; supervisor: any; quickWorkflow: any; namedWorkflow: any; cloudflare: any; database?: Database.Database }) {
    Object.assign(this, options); this.database = options.database;
  }
  private readonly database?: Database.Database;

  async listProjects(): Promise<any[]> {
    return this.store.listProjects().map((project: any) => {
      const tunnel = this.store.getTunnelForProject(project.id);
      let session: any; try { session = this.store.getLatestSession(project.id); } catch {}
      const observed = session ? this.supervisor.status(session.processKey) : { state: 'stopped', logs: '' };
      const status = !existsSync(project.path) ? 'Needs attention' : observed.state === 'running' ? 'Running' : 'Stopped';
      return { ...project, status, kind: tunnel?.kind, hostname: tunnel?.hostname, localUrl: tunnel?.localUrl, publicUrl: session?.ephemeralUrlExpired ? undefined : session?.ephemeralUrl, processState: observed.state };
    });
  }

  async getProject(id: string): Promise<any> {
    const project = this.store.getProject(id); const tunnel = this.store.getTunnelForProject(id);
    let session; try { session = this.store.getLatestSession(id); } catch {}
    const observed = session ? this.supervisor.status(session.processKey) : { state: 'stopped', logs: '' };
    return { ...project, tunnel, session, health: { localProcess: observed.state, cloudflareConnector: 'unknown', publicHostname: 'unchecked' }, logs: observed.logs };
  }

  async prepareQuick(input: any): Promise<PreparedPlan> { return this.savePlan('quick', input, [`Start a temporary Quick Tunnel to ${input.localUrl}.`], ['start-connector']); }
  async prepareNamed(input: any): Promise<PreparedPlan> { return this.savePlan('named', input, [`Create or reuse tunnel ${input.tunnelName}.`, `Create DNS route ${input.hostname}.`, `Start a connector to ${input.localUrl}.`], ['cloudflare-resources', 'start-connector']); }
  private savePlan(kind: 'quick' | 'named', input: any, effects: string[], confirmations: string[]): PreparedPlan {
    const plan = { id: crypto.randomUUID(), kind, input, effects, confirmations, createdAt: Date.now() }; this.plans.set(plan.id, plan); return plan;
  }

  async execute(id: string, confirmations: string[]): Promise<any> {
    const plan = this.plans.get(id); if (!plan) throw new Error('Plan not found or expired.');
    if (Date.now() - plan.createdAt > 10 * 60_000) { this.plans.delete(id); throw new Error('Plan expired. Review the settings again.'); }
    const missing = plan.confirmations.filter(item => !confirmations.includes(item));
    if (missing.length) throw new Error(`Confirmation required for: ${missing.join(', ')}`);
    this.plans.delete(id);
    return plan.kind === 'quick' ? this.quickWorkflow.run(plan.input) : this.namedWorkflow.run(plan.input);
  }

  async retry(projectId: string): Promise<any> { const tunnel = this.store.getTunnelForProject(projectId); return tunnel?.kind === 'named' ? this.namedWorkflow.retry(projectId) : this.quickWorkflow.restart(projectId); }
  async stop(projectId: string): Promise<void> { const tunnel = this.store.getTunnelForProject(projectId); return tunnel?.kind === 'named' ? this.namedWorkflow.stop(projectId) : this.quickWorkflow.stop(projectId); }
  async start(projectId: string): Promise<any> { return this.retry(projectId); }
  async restart(projectId: string): Promise<any> { try { await this.stop(projectId); } catch {} return this.start(projectId); }
  async doctor(): Promise<any> { const version = await this.cloudflare.version(); return { ok: version.ok, checks: [{ name: 'Node.js', state: 'passed', detail: process.version }, { name: 'cloudflared', state: version.ok ? 'passed' : 'failed', detail: version.ok ? version.value.version : version.error.summary }] }; }
  close(): void { this.database?.close(); }
}

export function createTunnelKitService(options: { dataDir?: string; cloudflaredExecutable?: string } = {}): TunnelKitService {
  const paths = options.dataDir ? { dataDir: options.dataDir, database: `${options.dataDir}/state.db`, projectsDir: `${options.dataDir}/projects`, backupsDir: `${options.dataDir}/backups` } : resolveAppPaths();
  const database = openStateDatabase(paths.database); const store = new StateStore(database); const supervisor = new ProcessSupervisor();
  const cloudflare = new CloudflaredAdapter({ executable: options.cloudflaredExecutable });
  const quickWorkflow = new QuickTunnelWorkflow({ store, supervisor, executable: options.cloudflaredExecutable });
  const namedWorkflow = new NamedTunnelWorkflow({ store, supervisor, cloudflare, projectsDir: paths.projectsDir, executable: options.cloudflaredExecutable });
  return new TunnelKitService({ store, supervisor, quickWorkflow, namedWorkflow, cloudflare, database });
}
