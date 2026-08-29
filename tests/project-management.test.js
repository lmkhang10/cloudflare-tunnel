import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStateDatabase, StateStore, TunnelKitService } from '../dist/index.js';

test('relinks a project and removes only local records', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-project-management-'));
  const db = openStateDatabase(path.join(root, 'state.db')); const store = new StateStore(db);
  const project = store.saveProject({ displayName: 'Shop', path: path.join(root, 'old'), profile: 'custom' });
  const calls = [];
  const service = new TunnelKitService({ store, supervisor: { status: () => ({ state: 'stopped', logs: '' }) }, quickWorkflow: {}, namedWorkflow: {}, cloudflare: { delete: async () => calls.push('delete') } });
  await service.relinkProject(project.id, path.join(root, 'new'));
  assert.equal(store.getProject(project.id).path, path.join(root, 'new'));
  await service.removeLocal(project.id);
  assert.equal(store.listProjects().length, 0);
  assert.deepEqual(calls, []);
  db.close(); await rm(root, { recursive: true, force: true });
});

test('refuses local removal while a managed connector is running', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-project-running-'));
  const db = openStateDatabase(path.join(root, 'state.db')); const store = new StateStore(db);
  const project = store.saveProject({ displayName: 'Shop', path: root, profile: 'custom' });
  store.saveSession({ projectId: project.id, processKey: 'quick:shop', state: 'running' });
  const service = new TunnelKitService({ store, supervisor: { status: () => ({ state: 'running', logs: '' }) }, quickWorkflow: {}, namedWorkflow: {}, cloudflare: {} });
  await assert.rejects(service.removeLocal(project.id), /Stop the connector/);
  db.close(); await rm(root, { recursive: true, force: true });
});
