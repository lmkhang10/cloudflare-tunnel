import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStateDatabase, StateStore, migrations } from '../dist/index.js';

test('persists a project and resumable workflow without secret content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-kit-db-'));
  const filename = path.join(root, 'state.db');
  const db = openStateDatabase(filename);
  const store = new StateStore(db);
  const project = store.saveProject({ displayName: 'Shop', path: '/work/shop', profile: 'custom' });
  const run = store.createWorkflow({ projectId: project.id, kind: 'named' });

  store.recordStep(run.id, {
    name: 'tunnel',
    state: 'succeeded',
    attempts: 1,
    effects: ['Created tunnel abc.'],
    safeResult: { authorization: 'Bearer private-token', tunnelId: 'abc' },
  });

  assert.equal(store.listProjects()[0].displayName, 'Shop');
  const saved = store.getWorkflow(run.id);
  assert.equal(saved.steps[0].state, 'succeeded');
  assert.match(JSON.stringify(saved), /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(saved), /private-token/);
  db.close();
  await rm(root, { recursive: true, force: true });
});

test('applies the initial migration only once across reopen', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-kit-migration-'));
  const filename = path.join(root, 'state.db');
  openStateDatabase(filename).close();
  const reopened = openStateDatabase(filename);
  const rows = reopened.prepare('SELECT version FROM schema_migrations').all();
  assert.deepEqual(rows, [{ version: 1 }, { version: 2 }]);
  reopened.close();
  await rm(root, { recursive: true, force: true });
});

test('upgrades a version 1 database with a backup and keeps existing projects', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-kit-v1-'));
  const filename = path.join(root, 'state.db');
  const legacy = new Database(filename);
  legacy.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  legacy.exec(migrations[0].sql);
  legacy.prepare('INSERT INTO schema_migrations VALUES (1, ?)').run(new Date().toISOString());
  legacy.prepare("INSERT INTO projects VALUES ('p1', 'Old', '/work/old', 'custom', 'x', 'x')").run();
  legacy.close();
  const db = openStateDatabase(filename);
  const store = new StateStore(db);
  assert.equal(store.getProject('p1').autoStart, false);
  store.setProjectAutoStart('p1', true);
  assert.equal(store.getProject('p1').autoStart, true);
  store.saveSettings({ trayEnabled: false });
  assert.deepEqual(store.getSettings(), { trayEnabled: false });
  await access(`${filename}.pre-migration-backup`);
  db.close(); await rm(root, { recursive: true, force: true });
});
