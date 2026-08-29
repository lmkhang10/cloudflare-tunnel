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
