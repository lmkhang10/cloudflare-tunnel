import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations.js';

export function openStateDatabase(filename: string): Database.Database {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const existed = existsSync(filename);
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(row => row.version));
  const pending = migrations.filter(migration => !applied.has(migration.version));
  if (existed && pending.length > 0) copyFileSync(filename, `${filename}.pre-migration-backup`);

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
    });
    try {
      apply();
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return db;
}
