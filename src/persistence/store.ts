import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { redactValue } from '../core/redact.js';
import type { Profile, TunnelKind, WorkflowStepState } from '../core/types.js';

export interface SavedProject { id: string; displayName: string; path: string; profile: Profile; autoStart: boolean; createdAt: string; updatedAt: string; }
export interface SavedWorkflow { id: string; projectId: string; kind: TunnelKind; state: WorkflowStepState; currentStep?: string; steps: SavedWorkflowStep[]; }
export interface SavedWorkflowStep { name: string; state: WorkflowStepState; attempts: number; effects: string[]; safeResult: unknown; error?: unknown; }
export interface SavedSession { id: string; projectId: string; processKey: string; pid?: number; state: string; ephemeralUrl?: string; ephemeralUrlExpired: boolean; startedAt: string; stoppedAt?: string; }
export interface SavedTunnel { id: string; projectId: string; kind: TunnelKind; name?: string; uuid?: string; hostname?: string; localUrl?: string; configPath?: string; credentialsPath?: string; accountId?: string; }
export interface SavedAccount { id: string; label: string; accountTag?: string; certPath: string; source: 'login' | 'import'; status: string; lastVerifiedAt?: string; createdAt: string; updatedAt: string; }

function safeJson(value: unknown): string { return JSON.stringify(redactValue(value)); }
const projectColumns = 'id, display_name, path, profile, auto_start, created_at, updated_at';
function projectRow(row: any): SavedProject { return { id: row.id, displayName: row.display_name, path: row.path, profile: row.profile, autoStart: Boolean(row.auto_start), createdAt: row.created_at, updatedAt: row.updated_at }; }
function tunnelRow(row: any): SavedTunnel { return { id: row.id, projectId: row.project_id, kind: row.kind, name: row.name ?? undefined, uuid: row.uuid ?? undefined, hostname: row.hostname ?? undefined, localUrl: row.local_url ?? undefined, configPath: row.config_path ?? undefined, credentialsPath: row.credentials_path ?? undefined, accountId: row.account_id ?? undefined }; }
function accountRow(row: any): SavedAccount { return { id: row.id, label: row.label, accountTag: row.account_tag ?? undefined, certPath: row.cert_path, source: row.source, status: row.status, lastVerifiedAt: row.last_verified_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at }; }

export class StateStore {
  constructor(private readonly db: Database.Database) {}

  saveProject(input: { displayName: string; path: string; profile: Profile }): SavedProject {
    const existing = this.db.prepare('SELECT id, created_at FROM projects WHERE path = ?').get(input.path) as { id: string; created_at: string } | undefined;
    const now = new Date().toISOString();
    const id = existing?.id ?? crypto.randomUUID();
    const createdAt = existing?.created_at ?? now;
    this.db.prepare(`
      INSERT INTO projects(id, display_name, path, profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET display_name=excluded.display_name, profile=excluded.profile, updated_at=excluded.updated_at
    `).run(id, input.displayName, input.path, input.profile, createdAt, now);
    return this.getProject(id);
  }

  listProjects(): SavedProject[] {
    return (this.db.prepare(`SELECT ${projectColumns} FROM projects ORDER BY updated_at DESC`).all() as any[]).map(projectRow);
  }

  getProject(id: string): SavedProject {
    const row = this.db.prepare(`SELECT ${projectColumns} FROM projects WHERE id=?`).get(id) as any;
    if (!row) throw new Error(`Project not found: ${id}`);
    return projectRow(row);
  }

  relinkProject(id: string, nextPath: string): void {
    const result = this.db.prepare('UPDATE projects SET path=?, updated_at=? WHERE id=?').run(nextPath, new Date().toISOString(), id);
    if (!result.changes) throw new Error(`Project not found: ${id}`);
  }

  setProjectAutoStart(id: string, autoStart: boolean): void {
    const result = this.db.prepare('UPDATE projects SET auto_start=? WHERE id=?').run(autoStart ? 1 : 0, id);
    if (!result.changes) throw new Error(`Project not found: ${id}`);
  }

  removeProject(id: string): void {
    const result = this.db.prepare('DELETE FROM projects WHERE id=?').run(id);
    if (!result.changes) throw new Error(`Project not found: ${id}`);
  }

  saveTunnel(input: Omit<SavedTunnel, 'id'>): SavedTunnel {
    const existing = this.db.prepare('SELECT id FROM tunnels WHERE project_id=? ORDER BY updated_at DESC LIMIT 1').get(input.projectId) as { id: string } | undefined;
    const id = existing?.id ?? crypto.randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO tunnels(id, project_id, kind, name, uuid, hostname, local_url, config_path, credentials_path, account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, name=excluded.name, uuid=excluded.uuid, hostname=excluded.hostname,
      local_url=excluded.local_url, config_path=excluded.config_path, credentials_path=excluded.credentials_path, account_id=excluded.account_id, updated_at=excluded.updated_at`)
      .run(id, input.projectId, input.kind, input.name ?? null, input.uuid ?? null, input.hostname ?? null, input.localUrl ?? null, input.configPath ?? null, input.credentialsPath ?? null, input.accountId ?? null, now, now);
    return { id, ...input };
  }

  getTunnelForProject(projectId: string): SavedTunnel | undefined {
    const row = this.db.prepare('SELECT * FROM tunnels WHERE project_id=? ORDER BY updated_at DESC LIMIT 1').get(projectId) as any;
    return row ? tunnelRow(row) : undefined;
  }

  listTunnels(): SavedTunnel[] { return (this.db.prepare('SELECT * FROM tunnels ORDER BY updated_at DESC').all() as any[]).map(tunnelRow); }

  assignTunnelAccount(tunnelId: string, accountId: string | null): void { this.db.prepare('UPDATE tunnels SET account_id=? WHERE id=?').run(accountId, tunnelId); }

  getSettings(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[];
    return Object.fromEntries(rows.map(row => [row.key, JSON.parse(row.value_json)]));
  }

  saveSettings(values: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const upsert = this.db.prepare('INSERT INTO settings(key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at');
    this.db.transaction(() => { for (const [key, value] of Object.entries(values)) upsert.run(key, JSON.stringify(value), now); })();
  }

  listAccounts(): SavedAccount[] { return (this.db.prepare('SELECT * FROM cloudflare_accounts ORDER BY created_at').all() as any[]).map(accountRow); }

  getAccount(id: string): SavedAccount {
    const row = this.db.prepare('SELECT * FROM cloudflare_accounts WHERE id=?').get(id) as any;
    if (!row) throw new Error(`Cloudflare account not found: ${id}`);
    return accountRow(row);
  }

  findAccountByTag(accountTag: string): SavedAccount | undefined {
    const row = this.db.prepare('SELECT * FROM cloudflare_accounts WHERE account_tag=?').get(accountTag) as any;
    return row ? accountRow(row) : undefined;
  }

  saveAccount(input: { id?: string; label: string; accountTag?: string; certPath: string; source: 'login' | 'import' }): SavedAccount {
    const id = input.id ?? crypto.randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO cloudflare_accounts(id, label, account_tag, cert_path, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'unverified', ?, ?)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label, account_tag=excluded.account_tag, cert_path=excluded.cert_path, status='unverified', updated_at=excluded.updated_at`)
      .run(id, input.label, input.accountTag ?? null, input.certPath, input.source, now, now);
    return this.getAccount(id);
  }

  updateAccount(id: string, input: { label?: string; status?: string; verified?: boolean }): SavedAccount {
    const current = this.getAccount(id); const now = new Date().toISOString();
    this.db.prepare('UPDATE cloudflare_accounts SET label=?, status=?, last_verified_at=?, updated_at=? WHERE id=?')
      .run(input.label ?? current.label, input.status ?? current.status, input.verified ? now : current.lastVerifiedAt ?? null, now, id);
    return this.getAccount(id);
  }

  removeAccount(id: string): void {
    const result = this.db.prepare('DELETE FROM cloudflare_accounts WHERE id=?').run(id);
    if (!result.changes) throw new Error(`Cloudflare account not found: ${id}`);
  }

  countTunnelsForAccount(id: string): number { return (this.db.prepare('SELECT COUNT(*) AS count FROM tunnels WHERE account_id=?').get(id) as { count: number }).count; }

  createWorkflow(input: { projectId: string; kind: TunnelKind }): { id: string } {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO workflow_runs(id, project_id, kind, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.projectId, input.kind, 'pending', now, now);
    return { id };
  }

  recordStep(runId: string, input: { name: string; state: WorkflowStepState; attempts: number; effects: string[]; safeResult: unknown; error?: unknown }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workflow_steps(id, workflow_run_id, name, state, attempts, effects_json, safe_result_json, error_json, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_run_id, name) DO UPDATE SET
        state=excluded.state, attempts=excluded.attempts, effects_json=excluded.effects_json,
        safe_result_json=excluded.safe_result_json, error_json=excluded.error_json,
        started_at=COALESCE(workflow_steps.started_at, excluded.started_at), finished_at=excluded.finished_at
    `).run(
      crypto.randomUUID(), runId, input.name, input.state, input.attempts,
      safeJson(input.effects), safeJson(input.safeResult), input.error === undefined ? null : safeJson(input.error),
      now, ['succeeded', 'warning', 'failed', 'cancelled'].includes(input.state) ? now : null,
    );
    this.db.prepare('UPDATE workflow_runs SET state=?, current_step=?, updated_at=? WHERE id=?')
      .run(input.state === 'failed' ? 'failed' : input.state === 'cancelled' ? 'cancelled' : 'running', input.name, now, runId);
  }

  getWorkflow(id: string): SavedWorkflow {
    const run = this.db.prepare('SELECT id, project_id, kind, state, current_step FROM workflow_runs WHERE id = ?').get(id) as any;
    if (!run) throw new Error(`Workflow not found: ${id}`);
    const rows = this.db.prepare('SELECT name, state, attempts, effects_json, safe_result_json, error_json FROM workflow_steps WHERE workflow_run_id = ? ORDER BY rowid').all(id) as any[];
    return {
      id: run.id, projectId: run.project_id, kind: run.kind, state: run.state, currentStep: run.current_step ?? undefined,
      steps: rows.map(row => ({
        name: row.name, state: row.state, attempts: row.attempts,
        effects: JSON.parse(row.effects_json), safeResult: JSON.parse(row.safe_result_json),
        error: row.error_json ? JSON.parse(row.error_json) : undefined,
      })),
    };
  }

  completeWorkflow(id: string, state: 'succeeded' | 'failed' | 'cancelled'): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE workflow_runs SET state=?, updated_at=?, finished_at=? WHERE id=?').run(state, now, now, id);
  }

  saveSession(input: { projectId: string; processKey: string; pid?: number; state: string; ephemeralUrl?: string; executable?: string }): SavedSession {
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO process_sessions(id, project_id, process_key, pid, executable, state, ephemeral_url, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.projectId, input.processKey, input.pid ?? null, input.executable ?? null, input.state, input.ephemeralUrl ?? null, startedAt);
    return { id, projectId: input.projectId, processKey: input.processKey, pid: input.pid, state: input.state, ephemeralUrl: input.ephemeralUrl, ephemeralUrlExpired: false, startedAt };
  }

  getLatestSession(projectId: string): SavedSession {
    const row = this.db.prepare('SELECT * FROM process_sessions WHERE project_id=? ORDER BY started_at DESC LIMIT 1').get(projectId) as any;
    if (!row) throw new Error(`Process session not found for project: ${projectId}`);
    return { id: row.id, projectId: row.project_id, processKey: row.process_key, pid: row.pid ?? undefined, state: row.state, ephemeralUrl: row.ephemeral_url ?? undefined, ephemeralUrlExpired: Boolean(row.ephemeral_url_expired), startedAt: row.started_at, stoppedAt: row.stopped_at ?? undefined };
  }

  findProjectIdBySessionKey(processKey: string): string | undefined {
    const row = this.db.prepare('SELECT project_id FROM process_sessions WHERE process_key=? ORDER BY started_at DESC LIMIT 1').get(processKey) as { project_id: string } | undefined;
    return row?.project_id;
  }

  listOpenSessions(): SavedSession[] {
    const rows = this.db.prepare("SELECT * FROM process_sessions WHERE state='running' AND stopped_at IS NULL").all() as any[];
    return rows.map(row => ({ id: row.id, projectId: row.project_id, processKey: row.process_key, pid: row.pid ?? undefined, state: row.state, ephemeralUrl: row.ephemeral_url ?? undefined, ephemeralUrlExpired: Boolean(row.ephemeral_url_expired), startedAt: row.started_at }));
  }

  stopSession(id: string): void {
    this.db.prepare('UPDATE process_sessions SET state=?, ephemeral_url_expired=1, stopped_at=? WHERE id=?').run('stopped', new Date().toISOString(), id);
  }
}
