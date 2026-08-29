import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStateDatabase, StateStore, TunnelKitService } from '../dist/index.js';

test('reconciles stored sessions before showing project status', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-service-'));
  const db = openStateDatabase(path.join(root, 'state.db'));
  const store = new StateStore(db);
  const live = store.saveProject({ displayName: 'Live', path: root, profile: 'custom' });
  const stale = store.saveProject({ displayName: 'Stale', path: path.join(root, 'missing'), profile: 'custom' });
  store.saveSession({ projectId: live.id, processKey: 'quick:live', state: 'running', ephemeralUrl: 'https://one.trycloudflare.com' });
  store.saveSession({ projectId: stale.id, processKey: 'quick:stale', state: 'running' });
  const service = new TunnelKitService({
    store,
    supervisor: { status: key => ({ state: key === 'quick:live' ? 'running' : 'stopped', logs: '' }) },
    quickWorkflow: {}, namedWorkflow: {}, cloudflare: { version: async () => ({ ok: true, value: { version: 'x' } }) },
  });
  const projects = await service.listProjects();
  assert.equal(projects.find(p => p.id === live.id).status, 'Running');
  assert.equal(projects.find(p => p.id === stale.id).status, 'Needs attention');
  db.close(); await rm(root, { recursive: true, force: true });
});

test('prepares a review plan before executing a workflow', async () => {
  let received;
  const service = new TunnelKitService({ store: {}, supervisor: {}, cloudflare: {}, namedWorkflow: {}, quickWorkflow: { run: async input => { received = input; return { state: 'succeeded' }; } } });
  const plan = await service.prepareQuick({ projectPath: '/work/shop', profile: 'custom', localUrl: 'http://127.0.0.1:8000' });
  assert.deepEqual(plan.effects, ['Start a temporary Quick Tunnel to http://127.0.0.1:8000.']);
  await service.execute(plan.id, ['start-connector']);
  assert.equal(received.localUrl, 'http://127.0.0.1:8000');
});
