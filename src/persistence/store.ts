import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { redactValue } from '../core/redact.js';
import type { Profile, TunnelKind, WorkflowStepState } from '../core/types.js';

export interface SavedProject { id: string; displayName: string; path: string; profile: Profile; createdAt: string; updatedAt: string; }
export interface SavedWorkflow { id: string; projectId: string; kind: TunnelKind; state: WorkflowStepState; currentStep?: string; steps: SavedWorkflowStep[]; }
export interface SavedWorkflowStep { name: string; state: WorkflowStepState; attempts: number; effects: string[]; safeResult: unknown; error?: unknown; }

function safeJson(value: unknown): string { return JSON.stringify(redactValue(value)); }

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
    return { id, ...input, createdAt, updatedAt: now };
  }

  listProjects(): SavedProject[] {
    const rows = this.db.prepare('SELECT id, display_name, path, profile, created_at, updated_at FROM projects ORDER BY updated_at DESC').all() as any[];
    return rows.map(row => ({ id: row.id, displayName: row.display_name, path: row.path, profile: row.profile, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

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
}
