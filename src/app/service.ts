import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { resolveAppPaths } from './paths.js';
import { openStateDatabase } from '../persistence/database.js';
import { StateStore } from '../persistence/store.js';
import { ProcessSupervisor } from '../providers/process-supervisor.js';
import { CloudflaredAdapter } from '../providers/cloudflared.js';
import { QuickTunnelWorkflow } from '../core/quick-workflow.js';
import { NamedTunnelWorkflow } from '../core/named-workflow.js';

const PLAN_TTL_MS = 10 * 60_000;

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
    return plan.kind === 'quick' ? this.quickWorkflow.run(plan.input) : this.namedWorkflow.run(plan.input);
  }

  async retry(projectId: string): Promise<any> { const tunnel = this.store.getTunnelForProject(projectId); return tunnel?.kind === 'named' ? this.namedWorkflow.retry(projectId) : this.quickWorkflow.restart(projectId); }
  async stop(projectId: string): Promise<void> { const tunnel = this.store.getTunnelForProject(projectId); return tunnel?.kind === 'named' ? this.namedWorkflow.stop(projectId) : this.quickWorkflow.stop(projectId); }
  async start(projectId: string): Promise<any> { return this.retry(projectId); }
  async restart(projectId: string): Promise<any> { try { await this.stop(projectId); } catch {} return this.start(projectId); }
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
  async doctor(): Promise<any> { const version = await this.cloudflare.version(); return { ok: version.ok, checks: [{ name: 'Node.js', state: 'passed', detail: process.version }, { name: 'cloudflared', state: version.ok ? 'passed' : 'failed', detail: version.ok ? version.value.version : version.error.summary }] }; }
  close(): void { this.database?.close(); }
}

export function createTunnelKitService(options: { dataDir?: string; cloudflaredExecutable?: string } = {}): TunnelKitService {
  const paths = options.dataDir ? { dataDir: options.dataDir, database: path.join(options.dataDir, 'state.db'), projectsDir: path.join(options.dataDir, 'projects'), backupsDir: path.join(options.dataDir, 'backups') } : resolveAppPaths();
  const database = openStateDatabase(paths.database); const store = new StateStore(database); const supervisor = new ProcessSupervisor();
  const cloudflare = new CloudflaredAdapter({ executable: options.cloudflaredExecutable });
  const quickWorkflow = new QuickTunnelWorkflow({ store, supervisor, executable: options.cloudflaredExecutable });
  const namedWorkflow = new NamedTunnelWorkflow({ store, supervisor, cloudflare, projectsDir: paths.projectsDir, executable: options.cloudflaredExecutable });
  return new TunnelKitService({ store, supervisor, quickWorkflow, namedWorkflow, cloudflare, database });
}
