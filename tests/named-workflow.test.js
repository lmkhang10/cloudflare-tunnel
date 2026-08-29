import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStateDatabase, StateStore, ProcessSupervisor, NamedTunnelWorkflow, tunnelError } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./helpers/fake-cloudflared.js', import.meta.url));

async function harness({ denyDnsOnce = false, requireLogin = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-named-workflow-'));
  const credentials = path.join(root, '11111111-1111-4111-8111-111111111111.json');
  await writeFile(credentials, '{}');
  const db = openStateDatabase(path.join(root, 'state.db'));
  const store = new StateStore(db);
  let createCalls = 0, routeCalls = 0, loginCalls = 0, listCalls = 0;
  const cloudflare = {
    async version() { return { ok: true, value: { version: '2026.8.0' } }; },
    async listTunnels() { listCalls++; if (requireLogin && listCalls === 1) return { ok: false, error: tunnelError('AUTH_STALE') }; return { ok: true, value: createCalls ? [{ uuid: '11111111-1111-4111-8111-111111111111', name: 'shop-local', connections: 0 }] : [] }; },
    async login() { loginCalls++; return { ok: true, value: { completed: true } }; },
    async createTunnel() { createCalls++; return { ok: true, value: { uuid: '11111111-1111-4111-8111-111111111111', credentialsFile: credentials } }; },
    async validateIngress() { return { ok: true, value: { valid: true } }; },
    async routeDns(_tunnel, hostname) { routeCalls++; if (denyDnsOnce && routeCalls === 1) return { ok: false, error: tunnelError('DNS_PERMISSION_DENIED', { hostname }) }; return { ok: true, value: { hostname } }; },
    async info() { return { ok: true, value: { connectorState: 'healthy' } }; },
  };
  const supervisor = new ProcessSupervisor();
  const workflow = new NamedTunnelWorkflow({
    store, cloudflare, supervisor, projectsDir: path.join(root, 'projects'), executable: process.execPath,
    baseArgs: [fixture], env: { ...process.env, FAKE_CLOUDFLARED_SCENARIO: 'connector-running' },
    originCheck: async () => ({ reachable: true, status: 200 }), publicCheck: async () => ({ reachable: true, status: 200 }),
  });
  return { root, db, store, supervisor, workflow, counts: () => ({ createCalls, routeCalls, loginCalls }) };
}

const input = root => ({ projectPath: path.join(root, 'shop'), displayName: 'Shop', profile: 'custom', localUrl: 'http://127.0.0.1:8000', tunnelName: 'shop-local', hostname: 'dev.example.com' });

test('completes authentication, create, config, DNS, connector, and health', async () => {
  const h = await harness({ requireLogin: true });
  const result = await h.workflow.run(input(h.root));
  assert.equal(result.state, 'succeeded');
  assert.equal(result.publicUrl, 'https://dev.example.com');
  assert.equal(h.counts().loginCalls, 1);
  const config = await readFile(result.configPath, 'utf8');
  assert.match(config, /hostname: "dev\.example\.com"/);
  assert.equal(config.includes(h.root + '/shop'), false);
  await h.workflow.stop(result.projectId);
  h.db.close(); await rm(h.root, { recursive: true, force: true });
});

test('retries DNS permission failure without creating another tunnel', async () => {
  const h = await harness({ denyDnsOnce: true });
  const first = await h.workflow.run(input(h.root));
  assert.equal(first.state, 'failed');
  assert.equal(first.error.code, 'DNS_PERMISSION_DENIED');
  const second = await h.workflow.retry(first.projectId);
  assert.equal(second.state, 'succeeded');
  assert.deepEqual(h.counts(), { createCalls: 1, routeCalls: 2, loginCalls: 0 });
  await h.workflow.stop(second.projectId);
  h.db.close(); await rm(h.root, { recursive: true, force: true });
});

test('persists edited hostname and local URL when reusing a tunnel', async () => {
  const h = await harness();
  const first = await h.workflow.run(input(h.root));
  await h.workflow.stop(first.projectId);
  const edited = { ...input(h.root), localUrl: 'http://127.0.0.1:3000', hostname: 'preview.example.com' };
  const second = await h.workflow.run(edited);
  const saved = h.store.getTunnelForProject(second.projectId);
  assert.equal(saved.localUrl, edited.localUrl);
  assert.equal(saved.hostname, edited.hostname);
  await h.workflow.stop(second.projectId);
  h.db.close(); await rm(h.root, { recursive: true, force: true });
});
