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

test('starts with a warning when a slow origin still accepts connections', async () => {
  const result = await checkOrigin('http://127.0.0.1:8000', {
    timeoutMs: 1000,
    fetchImpl: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    connectImpl: async () => true,
  });
  assert.equal(result.reachable, true);
  assert.equal(result.warning.code, 'ORIGIN_SLOW');
});

test('reports a timeout when nothing accepts connections', async () => {
  const result = await checkOrigin('http://127.0.0.1:8000', {
    timeoutMs: 1000,
    fetchImpl: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    connectImpl: async () => false,
  });
  assert.equal(result.reachable, false);
  assert.equal(result.error.code, 'ORIGIN_TIMEOUT');
});

test('a real hanging origin is slow, not unreachable', async () => {
  const net = await import('node:net');
  const server = net.createServer(() => {}).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const result = await checkOrigin(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 300 });
    assert.equal(result.reachable, true);
    assert.equal(result.warning.code, 'ORIGIN_SLOW');
  } finally {
    server.close();
  }
});

test('a public hostname timeout stays a failure without the TCP probe', async () => {
  let probed = false;
  const result = await checkOrigin('https://dev.example.com', {
    timeoutMs: 1000,
    tcpFallback: false,
    fetchImpl: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); },
    connectImpl: async () => { probed = true; return true; },
  });
  assert.equal(probed, false);
  assert.equal(result.reachable, false);
  assert.equal(result.error.code, 'ORIGIN_TIMEOUT');
});
