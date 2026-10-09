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
  assert.match(html, /v0\.1\.8/);
  assert.match(html, /Remove local/);
  assert.doesNotMatch(html, /No plan yet/);
  assert.match(html, /class="drawer"/);
  assert.match(html, /class="drawer-overlay"/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.doesNotMatch(html, /<dialog|showModal\(/);
  assert.match(html, /document\.body\.style\.overflow='hidden'/);
  assert.match(html, /e\.key(===|!==)'Escape'/);
  assert.match(html, /wizardTrigger\?\.focus/);
  assert.match(html, /<div class="drawer-overlay" data-close>/);
  assert.match(html, /<button class="close" data-close/);
  assert.match(html, /<button class="btn ghost" data-close>Cancel/);
  assert.match(html, /target===overlay/);
  assert.match(html, /!running/);
  assert.match(html, /publicUrl/);
  assert.match(html, /Copy URL/);
  assert.match(html, /navigator\.clipboard\.writeText/);
  assert.match(html, /data-action="details"/);
  assert.match(html, /\/api\/projects\//);
  assert.match(html, /cloudflareConnector/);
  assert.match(html, /result\.state==='failed'/, 'project actions surface workflow failures');
  assert.match(html, /Starting…/);
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

test('ships page scripts that parse', async () => {
  const { Script } = await import('node:vm');
  const html = dashboardPage('1.0.0', { shell: 'desktop', daemon: true });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const source of scripts) assert.doesNotThrow(() => new Script(source), 'inline dashboard script must be valid JavaScript');
});

test('pushes project changes over Server-Sent Events only when they change', async () => {
  let projects = [{ id: 'p1', status: 'Stopped' }];
  const server = createServer({ service: { listProjects: async () => projects }, streamIntervalMs: 50 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stream`, { signal: controller.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = '';
    const readUntil = async pattern => { while (!pattern.test(text)) text += decoder.decode((await reader.read()).value); };
    await readUntil(/"Stopped"/);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(text.match(/event: projects/g).length, 1, 'no repeat while nothing changed');
    projects = [{ id: 'p1', status: 'Running' }];
    await readUntil(/"Running"/);
    assert.equal(text.match(/event: projects/g).length, 2);
  } finally { controller.abort(); server.closeAllConnections(); server.close(); }
});
