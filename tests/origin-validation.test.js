import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTunnelConfig, checkOrigin } from '../dist/index.js';

test('requires and normalizes a named public hostname', () => {
  const result = validateTunnelConfig({ profile: 'custom', operation: 'create', localUrl: 'http://127.0.0.1:8000', tunnelName: 'shop', hostname: 'DEV.Example.com' });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.hostname, 'dev.example.com');
});

test('rejects named tunnels without a hostname', () => {
  const result = validateTunnelConfig({ profile: 'custom', operation: 'create', localUrl: 'http://127.0.0.1:8000', tunnelName: 'shop' });
  assert.equal(result.ok, false);
  assert.equal(result.issues.some(issue => issue.code === 'INPUT_HOSTNAME_REQUIRED'), true);
});

test('rejects localhost, wildcard, IP, and URL-shaped public hostnames', () => {
  for (const hostname of ['localhost', '*.example.com', '127.0.0.1', 'https://dev.example.com/path']) {
    const result = validateTunnelConfig({ profile: 'custom', operation: 'create', localUrl: 'http://127.0.0.1:8000', tunnelName: 'shop', hostname });
    assert.equal(result.ok, false, hostname);
  }
});

test('treats an HTTP 404 origin as reachable with a warning', async () => {
  const result = await checkOrigin('http://127.0.0.1:8000', {
    timeoutMs: 1000,
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert.equal(result.reachable, true);
  assert.equal(result.warning.code, 'ORIGIN_HTTP_CLIENT_ERROR');
});

test('classifies a refused local origin', async () => {
  const result = await checkOrigin('http://127.0.0.1:8000', {
    timeoutMs: 1000,
    fetchImpl: async () => { const error = new TypeError('fetch failed'); error.cause = { code: 'ECONNREFUSED' }; throw error; },
  });
  assert.equal(result.reachable, false);
  assert.equal(result.error.code, 'ORIGIN_CONNECTION_REFUSED');
});
