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
