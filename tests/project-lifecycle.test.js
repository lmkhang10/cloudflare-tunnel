import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStateDatabase, StateStore, ProcessSupervisor, NamedTunnelWorkflow, TunnelKitService, CloudflareDnsClient } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./helpers/fake-cloudflared.js', import.meta.url));
const UUID = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';

async function harness({ existing = [] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-lifecycle-'));
  const credentials = path.join(root, `${UUID}.json`); await writeFile(credentials, '{}');
  const db = openStateDatabase(path.join(root, 'state.db')); const store = new StateStore(db);
  const calls = []; let tunnels = [...existing];
  const cloudflare = {
    async version() { return { ok: true, value: { version: '2026.8.0' } }; },
    async listTunnels() { return { ok: true, value: tunnels }; },
    async createTunnel(name) { calls.push(['create', name]); await writeFile(credentials, '{}'); tunnels.push({ uuid: UUID, name, connections: 0 }); return { ok: true, value: { uuid: UUID, credentialsFile: credentials } }; },
    async validateIngress() { return { ok: true, value: { valid: true } }; },
    async routeDns(tunnel, hostname) { calls.push(['route', tunnel, hostname]); return { ok: true, value: { hostname } }; },
    async info() { return { ok: true, value: { connectorState: 'healthy' } }; },
    async deleteTunnel(uuid) { calls.push(['delete-tunnel', uuid]); tunnels = tunnels.filter(item => item.uuid !== uuid); return { ok: true, value: { deleted: true, alreadyGone: false } }; },
  };
  const dns = { async deleteTunnelRecord(hostname, uuid) { calls.push(['delete-dns', hostname, uuid]); return { state: 'deleted', detail: `Deleted the DNS record for ${hostname}.` }; } };
  const supervisor = new ProcessSupervisor();
  const projectsDir = path.join(root, 'projects');
  const namedWorkflow = new NamedTunnelWorkflow({
    store, cloudflare, dnsFor: () => dns, supervisor, projectsDir, executable: process.execPath,
    baseArgs: [fixture], env: { ...process.env, FAKE_CLOUDFLARED_SCENARIO: 'connector-running' },
    originCheck: async () => ({ reachable: true, status: 200 }), publicCheck: async () => ({ reachable: true, status: 200 }),
  });
  const service = new TunnelKitService({ store, supervisor, quickWorkflow: {}, namedWorkflow, cloudflare });
  const projectPath = path.join(root, 'shop'); await mkdir(projectPath);
  const input = { projectPath, displayName: 'Shop', profile: 'custom', localUrl: 'http://127.0.0.1:8000', tunnelName: 'shop', hostname: 'dev.example.com' };
  const cleanup = async () => { await supervisor.stopAll?.(); db.close(); await rm(root, { recursive: true, force: true }); };
  return { root, store, service, namedWorkflow, calls, input, credentials, projectsDir, cleanup };
}

test('delete stops the connector and removes the tunnel, DNS record, and local files', async () => {
  const h = await harness();
  const created = await h.namedWorkflow.run(h.input);
  assert.equal(created.state, 'succeeded');
  const result = await h.service.deleteProject(created.projectId);
  assert.equal(result.deleted, true); assert.equal(result.tunnelDeleted, true); assert.deepEqual(result.warnings, []);
  assert.deepEqual(h.calls.filter(call => call[0].startsWith('delete')), [['delete-dns', 'dev.example.com', UUID], ['delete-tunnel', UUID]]);
  assert.equal(h.store.listProjects().length, 0);
  await assert.rejects(stat(h.credentials)); await assert.rejects(stat(path.join(h.projectsDir, created.projectId)));
  // The same names work again right away.
  const again = await h.namedWorkflow.run(h.input);
  assert.equal(again.state, 'succeeded');
  await h.cleanup();
});

test('delete keeps the project when Cloudflare refuses to delete the tunnel', async () => {
  const h = await harness();
  const created = await h.namedWorkflow.run(h.input);
  h.namedWorkflow.cloudflareFor = () => ({ deleteTunnel: async () => ({ ok: false, error: { code: 'CLOUDFLARED_COMMAND_FAILED', summary: 'boom' } }) });
  await assert.rejects(h.service.deleteProject(created.projectId), /Could not delete the Cloudflare tunnel: boom/);
  assert.equal(h.store.listProjects().length, 1);
  await h.cleanup();
});

test('edit changes the port, restarts a running tunnel, and drops the old DNS record on a new hostname', async () => {
  const h = await harness();
  const created = await h.namedWorkflow.run(h.input);
  h.store.saveSession({ projectId: created.projectId, processKey: created.sessionKey, state: 'running' });
  const result = await h.service.updateProject(created.projectId, { displayName: 'Shop API', localUrl: 'http://127.0.0.1:9000', hostname: 'api.example.com' });
  assert.equal(result.restarted, true); assert.equal(result.result.state, 'succeeded');
  const tunnel = h.store.getTunnelForProject(created.projectId);
  assert.equal(tunnel.localUrl, 'http://127.0.0.1:9000'); assert.equal(tunnel.hostname, 'api.example.com'); assert.equal(tunnel.uuid, UUID);
  assert.equal(h.store.getProject(created.projectId).displayName, 'Shop API');
  assert.deepEqual(h.calls.filter(call => call[0] === 'route').at(-1), ['route', UUID, 'api.example.com']);
  assert.deepEqual(h.calls.filter(call => call[0] === 'delete-dns'), [['delete-dns', 'dev.example.com', UUID]]);
  assert.equal(h.calls.filter(call => call[0] === 'create').length, 1);
  await h.cleanup();
});

test('edit rejects renaming an existing tunnel and invalid URLs', async () => {
  const h = await harness();
  const created = await h.namedWorkflow.run(h.input);
  await assert.rejects(h.service.updateProject(created.projectId, { tunnelName: 'other' }), /cannot rename/);
  await assert.rejects(h.service.updateProject(created.projectId, { localUrl: 'ftp://x' }), /http or https/);
  await h.cleanup();
});

test('a leftover tunnel with the same name can be replaced on request', async () => {
  const h = await harness({ existing: [{ uuid: OLD, name: 'shop', connections: 0 }] });
  const first = await h.namedWorkflow.run(h.input);
  assert.equal(first.error.code, 'TUNNEL_NAME_CONFLICT');
  const replaced = await h.service.replaceTunnel(first.projectId);
  assert.equal(replaced.state, 'succeeded');
  assert.deepEqual(h.calls.slice(0, 3), [['delete-dns', 'dev.example.com', OLD], ['delete-tunnel', OLD], ['create', 'shop']]);
  await h.cleanup();
});

test('DNS cleanup deletes only a CNAME that points at the tunnel', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-dns-'));
  const token = Buffer.from(JSON.stringify({ zoneID: 'a'.repeat(32), accountID: 'b'.repeat(32), apiToken: 'secret' })).toString('base64');
  const certPath = path.join(root, 'cert.pem'); await writeFile(certPath, `-----BEGIN ARGO TUNNEL TOKEN-----\n${token}\n-----END ARGO TUNNEL TOKEN-----\n`);
  const requests = []; let content = `${UUID}.cfargotunnel.com`;
  const fetch = async (url, init) => {
    requests.push([init.method, url.replace('https://api.cloudflare.com/client/v4', '')]);
    assert.equal(init.headers.Authorization, 'Bearer secret');
    const body = url.includes('/dns_records?') ? { success: true, result: [{ id: 'rec1', name: 'dev.example.com', content }] } : { success: true, result: [] };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const client = new CloudflareDnsClient({ certPath, fetch });
  assert.equal((await client.deleteTunnelRecord('dev.example.com', UUID)).state, 'deleted');
  assert.deepEqual(requests.at(-1), ['DELETE', `/zones/${'a'.repeat(32)}/dns_records/rec1`]);
  content = 'someone-else.example.net';
  requests.length = 0;
  assert.equal((await client.deleteTunnelRecord('dev.example.com', UUID)).state, 'skipped');
  assert.equal(requests.some(([method]) => method === 'DELETE'), false);
  assert.equal((await new CloudflareDnsClient({ certPath: path.join(root, 'missing.pem'), fetch }).deleteTunnelRecord('dev.example.com', UUID)).state, 'skipped');
  await rm(root, { recursive: true, force: true });
});
