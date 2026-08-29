export interface Migration { version: number; sql: string; }

export const migrations: Migration[] = [{
  version: 1,
  sql: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      profile TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE tunnels (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      name TEXT,
      uuid TEXT UNIQUE,
      hostname TEXT,
      local_url TEXT,
      config_path TEXT,
      credentials_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      state TEXT NOT NULL,
      current_step TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE workflow_steps (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      effects_json TEXT NOT NULL,
      safe_result_json TEXT NOT NULL,
      error_json TEXT,
      started_at TEXT,
      finished_at TEXT,
      UNIQUE(workflow_run_id, name)
    );
    CREATE TABLE process_sessions (
      id TEXT PRIMARY KEY,
      tunnel_id TEXT REFERENCES tunnels(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      process_key TEXT NOT NULL,
      pid INTEGER,
      executable TEXT,
      argv_fingerprint TEXT,
      state TEXT NOT NULL,
      ephemeral_url TEXT,
      ephemeral_url_expired INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      stopped_at TEXT
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      safe_data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE installations (
      id TEXT PRIMARY KEY,
      component TEXT NOT NULL UNIQUE,
      version TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );
  `,
}];
