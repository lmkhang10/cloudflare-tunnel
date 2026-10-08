import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactValue } from '../dist/index.js';

test('redacts PEM blocks, authorization headers, and query-string secrets', () => {
  const input = 'Authorization: Bearer abc.def.ghi\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\nhttps://x.test/?token=visible';
  const output = redact(input);
  assert.doesNotMatch(output, /abc\.def\.ghi|BEGIN PRIVATE KEY|token=visible/);
  assert.match(output, /\[REDACTED/);
});

test('redacts nested credential-shaped keys', () => {
  assert.deepEqual(redactValue({ safe: 'hello', account: { apiToken: 'visible' } }), { safe: 'hello', account: { apiToken: '[REDACTED]' } });
});

import { createServer } from '../dist/index.js';

async function withServer(options, run) {
  const server = createServer({ sessionToken: 'test-session-token', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(server.address().port); } finally { server.close(); }
}

test('rejects foreign Host headers on every route, including the session token', async () => {
  const { request } = await import('node:http');
  await withServer({}, async port => {
    for (const pathname of ['/', '/api/session', '/api/projects', '/api/settings']) {
      const status = await new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path: pathname, headers: { host: 'attacker.example:80' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject); req.end();
      });
      assert.equal(status, 403, pathname);
    }
  });
});

test('never accepts a certificate path from the browser when importing accounts', async () => {
  let called = false;
  await withServer({ service: { importAccount: () => { called = true; return {}; } } }, async port => {
    const response = await fetch(`http://127.0.0.1:${port}/api/accounts/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-confirmation-token': 'test-session-token' }, body: JSON.stringify({ certPath: '/etc/passwd' }) });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });
});

test('saves settings through the protected API and reports daemon health', async () => {
  const saved = [];
  const service = { updateSettings: patch => { saved.push(patch); return { values: patch }; }, settingsView: () => ({ values: {}, definitions: [] }) };
  await withServer({ service, version: '1.2.3', daemon: { pid: 42, startedAt: 'now', shutdown: async () => ({}), installUpdate: async () => ({}) } }, async port => {
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.deepEqual([health.version, health.pid, health.daemon], ['1.2.3', 42, true]);
    const denied = await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"trayEnabled":false}' });
    assert.equal(denied.status, 403);
    const ok = await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-confirmation-token': 'test-session-token' }, body: '{"trayEnabled":false}' });
    assert.equal(ok.status, 200);
    assert.deepEqual(saved, [{ trayEnabled: false }]);
  });
});
