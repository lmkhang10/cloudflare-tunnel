import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CloudflaredAdapter } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./helpers/fake-cloudflared.js', import.meta.url));

async function harness(scenario) {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-adapter-'));
  const record = path.join(root, 'argv.jsonl');
  const adapter = new CloudflaredAdapter({
    executable: process.execPath,
    baseArgs: [fixture],
    env: { ...process.env, FAKE_CLOUDFLARED_SCENARIO: scenario, FAKE_CLOUDFLARED_RECORD: record },
  });
  return { adapter, record, dispose: () => rm(root, { recursive: true, force: true }) };
}

test('creates a tunnel with argv and parses UUID and credential path', async () => {
  const h = await harness('create-success');
  const result = await h.adapter.createTunnel('shop-local');
  assert.equal(result.ok, true);
  assert.equal(result.value.uuid, '11111111-1111-4111-8111-111111111111');
  assert.match(result.value.credentialsFile, /11111111.*\.json$/);
  const calls = (await readFile(h.record, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0], ['tunnel', 'create', 'shop-local']);
  await h.dispose();
});

test('classifies revoked authentication', async () => {
  const h = await harness('auth-stale');
  const result = await h.adapter.listTunnels();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTH_STALE');
  await h.dispose();
});

test('passes hostile tunnel names as literal argv without shell execution', async () => {
  const h = await harness('create-success');
  await h.adapter.createTunnel('shop;touch-pwned');
  const calls = (await readFile(h.record, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0], ['tunnel', 'create', 'shop;touch-pwned']);
  await h.dispose();
});

test('selects the account with --origincert and stores credentials in the app folder', async () => {
  const h = await harness('create-success');
  const root = await mkdtemp(path.join(tmpdir(), 'cf-adapter-account-'));
  const adapter = new CloudflaredAdapter({ executable: process.execPath, baseArgs: [fixture], originCert: '/accounts/work/cert.pem', env: { ...process.env, FAKE_CLOUDFLARED_RECORD: h.record } });
  const credentialsFile = path.join(root, 'shop.json');
  const created = await adapter.createTunnel('shop', { credentialsFile });
  assert.equal(created.value.credentialsFile, credentialsFile);
  await adapter.routeDns('11111111-1111-4111-8111-111111111111', 'dev.example.com');
  await adapter.validateIngress('/app/config.yml');
  const calls = (await readFile(h.record, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[0], ['tunnel', '--origincert', '/accounts/work/cert.pem', 'create', '--credentials-file', credentialsFile, 'shop']);
  assert.deepEqual(calls[1], ['tunnel', '--origincert', '/accounts/work/cert.pem', 'route', 'dns', '11111111-1111-4111-8111-111111111111', 'dev.example.com']);
  assert.deepEqual(calls[2], ['tunnel', '--config', '/app/config.yml', 'ingress', 'validate'], 'cloudflared only accepts --config before the subcommand');
  await rm(root, { recursive: true, force: true }); await h.dispose();
});

test('classifies a missing certificate as AUTH_REQUIRED', async () => {
  const h = await harness('auth-missing');
  const result = await h.adapter.listTunnels();
  assert.equal(result.error.code, 'AUTH_REQUIRED');
  await h.dispose();
});

test('reads the tunnel id from the credentials file even when the path contains another UUID', async () => {
  const h = await harness('create-success');
  const root = await mkdtemp(path.join(tmpdir(), 'cf-adapter-uuid-'));
  const accountFolder = path.join(root, 'accounts', '8d390edd-11cc-42a6-9cfe-a798da649dd8', 'tunnels');
  const adapter = new CloudflaredAdapter({ executable: process.execPath, baseArgs: [fixture], originCert: '/c.pem', env: { ...process.env, FAKE_CLOUDFLARED_RECORD: h.record } });
  const created = await adapter.createTunnel('lfms', { credentialsFile: path.join(accountFolder, 'lfms.json') });
  assert.equal(created.value.uuid, '11111111-1111-4111-8111-111111111111');
  await rm(root, { recursive: true, force: true }); await h.dispose();
});

test('reports an existing DNS record and overwrites it only when asked', async () => {
  const h = await harness('dns-exists');
  const refused = await h.adapter.routeDns('11111111-1111-4111-8111-111111111111', 'dev.example.com');
  assert.equal(refused.error.code, 'DNS_RECORD_EXISTS');
  assert.ok(refused.error.availableActions.includes('replace-dns'));
  const replaced = await h.adapter.routeDns('11111111-1111-4111-8111-111111111111', 'dev.example.com', { overwrite: true });
  assert.equal(replaced.ok, true);
  const calls = (await readFile(h.record, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls[1], ['tunnel', 'route', 'dns', '--overwrite-dns', '11111111-1111-4111-8111-111111111111', 'dev.example.com']);
  await h.dispose();
});
