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

test('normalizes tunnel names and rejects invalid settings before the review step', async () => {
  const service = new TunnelKitService({ store: { getSettings: () => ({}) }, supervisor: {}, cloudflare: {}, namedWorkflow: {}, quickWorkflow: {} });
  const plan = await service.prepareNamed({ projectPath: '/work/lfms', profile: 'laravel', localUrl: 'http://127.0.0.1:8000', tunnelName: ' LFMS ', hostname: 'https://LFMS.Example.com/app' });
  assert.equal(plan.input.tunnelName, 'lfms');
  assert.equal(plan.input.hostname, 'lfms.example.com');
  await assert.rejects(service.prepareNamed({ projectPath: '/work/lfms', profile: 'custom', localUrl: 'http://127.0.0.1:8000', tunnelName: 'law firm', hostname: 'lfms.example.com' }), error => error.issues[0].field === 'tunnelName');
  await assert.rejects(service.prepareQuick({ projectPath: '/work/lfms', profile: 'custom', localUrl: 'ftp://x' }), error => error.issues[0].field === 'localUrl');
});

test('finds cloudflared in common install folders when PATH is minimal', async () => {
  const { withCommonBinDirs } = await import('../dist/index.js');
  assert.match(withCommonBinDirs('/usr/bin:/bin'), /^\/usr\/bin:\/bin:.*\/opt\/homebrew\/bin.*\/usr\/local\/bin/);
  const service = new TunnelKitService({ store: { getSettings: () => ({}) }, supervisor: {}, cloudflare: {}, namedWorkflow: {}, quickWorkflow: {} });
  const previous = process.env.PATH; process.env.PATH = '/usr/bin:/bin';
  try { assert.ok(service.executable() === 'cloudflared' || service.executable().startsWith('/'), 'resolves to an absolute path when installed'); }
  finally { process.env.PATH = previous; }
});
