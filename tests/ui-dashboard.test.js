import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardPage } from '../dist/ui/page.js';
import { createServer } from '../dist/ui/server.js';

test('renders the English project dashboard and both guided setup choices', () => {
  const html = dashboardPage();
  assert.match(html, /Your tunnels/);
  assert.match(html, /Quick Tunnel/);
  assert.match(html, /Custom domain/);
  assert.match(html, /Saved projects/);
  assert.match(html, /Review changes/);
  assert.match(html, /data-action="doctor"/);
  assert.doesNotMatch(html, /No plan yet/);
});

test('creates a service-injected UI server', () => {
  const service = { listProjects: async () => [], doctor: async () => ({ ok: true, checks: [] }) };
  const server = createServer({ service });
  assert.equal(typeof server.listen, 'function');
  server.close();
});

test('routes relink and local-only removal through protected mutations', async () => {
  const calls = [];
  const service = {
    listProjects: async () => [],
    doctor: async () => ({ ok: true, checks: [] }),
    relinkProject: async (id, nextPath) => calls.push(['relink', id, nextPath]),
    removeLocal: async id => calls.push(['remove', id]),
  };
  const server = createServer({ service, sessionToken: 'test-session-token' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const request = (pathname, body) => fetch(`http://127.0.0.1:${port}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-confirmation-token': 'test-session-token' },
      body: JSON.stringify(body),
    });
    assert.equal((await request('/api/projects/p1/relink', { path: '/new/project' })).status, 200);
    assert.equal((await request('/api/projects/p1/remove-local', {})).status, 200);
    assert.deepEqual(calls, [['relink', 'p1', '/new/project'], ['remove', 'p1']]);
  } finally { server.close(); }
});

test('rejects credential-shaped fields at the local HTTP boundary', async () => {
  let called = false;
  const service = { prepareNamed: async () => { called = true; return {}; } };
  const server = createServer({ service, sessionToken: 'test-session-token' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/plans/named`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-confirmation-token': 'test-session-token' },
      body: JSON.stringify({ hostname: 'dev.example.com', credentialsContent: 'must-not-enter-the-app' }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /secret or credential fields/i);
    assert.equal(called, false);
  } finally { server.close(); }
});
