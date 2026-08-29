import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStateDatabase, StateStore, ProcessSupervisor, QuickTunnelWorkflow } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./helpers/fake-cloudflared.js', import.meta.url));

test('starts, persists, and stops a Quick Tunnel without waiting for process exit', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-quick-workflow-'));
  const db = openStateDatabase(path.join(root, 'state.db'));
  const store = new StateStore(db);
  const supervisor = new ProcessSupervisor();
  const workflow = new QuickTunnelWorkflow({
    store,
    supervisor,
    executable: process.execPath,
    baseArgs: [fixture],
    env: { ...process.env, FAKE_CLOUDFLARED_SCENARIO: 'quick-running' },
    originCheck: async () => ({ reachable: true, status: 200 }),
  });

  const result = await workflow.run({ projectPath: root, displayName: 'Quick Shop', profile: 'custom', localUrl: 'http://127.0.0.1:8000' });
  assert.equal(result.state, 'succeeded');
  assert.equal(result.publicUrl, 'https://calm-river-123.trycloudflare.com');
  assert.equal(supervisor.status(result.sessionKey).state, 'running');
  assert.equal(store.listProjects().length, 1);
  assert.equal(store.getLatestSession(result.projectId).ephemeralUrl, result.publicUrl);

  await workflow.stop(result.projectId);
  assert.equal(store.getLatestSession(result.projectId).ephemeralUrlExpired, true);
  db.close();
  await rm(root, { recursive: true, force: true });
});

test('does not start cloudflared when the local origin is unavailable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-quick-origin-'));
  const db = openStateDatabase(path.join(root, 'state.db'));
  const store = new StateStore(db);
  const supervisor = new ProcessSupervisor();
  const workflow = new QuickTunnelWorkflow({
    store, supervisor, executable: process.execPath, baseArgs: [fixture],
    originCheck: async () => ({ reachable: false, error: { code: 'ORIGIN_CONNECTION_REFUSED', reason: 'Stopped', fix: 'Start it.' } }),
  });
  const result = await workflow.run({ projectPath: root, displayName: 'Stopped App', profile: 'custom', localUrl: 'http://127.0.0.1:8000' });
  assert.equal(result.state, 'failed');
  assert.equal(result.error.code, 'ORIGIN_CONNECTION_REFUSED');
  db.close();
  await rm(root, { recursive: true, force: true });
});
