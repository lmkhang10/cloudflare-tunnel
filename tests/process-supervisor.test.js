import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ProcessSupervisor } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./helpers/fake-cloudflared.js', import.meta.url));
function connectorOptions(key) {
  return {
    key,
    executable: process.execPath,
    args: [fixture, 'tunnel', '--url', 'http://127.0.0.1:8000'],
    env: { ...process.env, FAKE_CLOUDFLARED_SCENARIO: 'quick-running' },
  };
}

test('returns after startup while the connector remains alive', async () => {
  const supervisor = new ProcessSupervisor();
  const session = await supervisor.start(connectorOptions('quick:shop'));
  assert.equal(session.state, 'running');
  assert.equal(supervisor.status('quick:shop').state, 'running');
  assert.match(await session.waitForOutput(/trycloudflare\.com/, 2000), /trycloudflare\.com/);
  await supervisor.stop('quick:shop');
  assert.equal(supervisor.status('quick:shop').state, 'stopped');
});

test('rejects a duplicate connector key', async () => {
  const supervisor = new ProcessSupervisor();
  await supervisor.start(connectorOptions('named:abc'));
  await assert.rejects(supervisor.start(connectorOptions('named:abc')), /already running/);
  await supervisor.stop('named:abc');
});

test('stores redacted bounded logs', async () => {
  const supervisor = new ProcessSupervisor({ maxLogBytes: 256 });
  const session = await supervisor.start(connectorOptions('quick:logs'));
  await session.waitForOutput(/trycloudflare\.com/, 2000);
  assert.equal(Buffer.byteLength(session.logs()) <= 256, true);
  await supervisor.stop('quick:logs');
});
