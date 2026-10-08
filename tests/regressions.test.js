import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, TunnelKitService, QuickTunnelWorkflow, ProcessSupervisor } from '../dist/index.js';

test('keeps long public Quick Tunnel hostnames but still redacts long tokens', () => {
  const output = redact('INF | https://bulletin-tribe-catalog-pleasure.trycloudflare.com | id=abcdefghijklmnopqrstuvwxyz123456');
  assert.match(output, /https:\/\/bulletin-tribe-catalog-pleasure\.trycloudflare\.com/);
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz123456/);
});

test('rejects non-list confirmations instead of substring-matching them', async () => {
  const service = new TunnelKitService({ store: {}, supervisor: {}, quickWorkflow: { run: async () => ({ state: 'succeeded' }) }, namedWorkflow: {}, cloudflare: {} });
  const plan = await service.prepareQuick({ projectPath: '/work/shop', localUrl: 'http://127.0.0.1:8000' });
  await assert.rejects(service.execute(plan.id, 'start-connector'), /list/);
});

test('Quick Tunnel refuses non-loopback origins before touching state', async () => {
  const store = new Proxy({}, { get: () => { throw new Error('store must not be used'); } });
  const workflow = new QuickTunnelWorkflow({ store, supervisor: new ProcessSupervisor(), originCheck: async () => ({ reachable: true, status: 200 }) });
  const result = await workflow.run({ projectPath: process.cwd(), profile: 'custom', localUrl: 'http://192.168.1.20:8000' });
  assert.equal(result.state, 'failed');
  assert.equal(result.error.code, 'INPUT_UNSAFE_ORIGIN');
});

test('waitForOutput fails fast when the process exits', async () => {
  const supervisor = new ProcessSupervisor();
  const session = await supervisor.start({ key: 'exit', executable: process.execPath, args: ['-e', 'process.exit(1)'] });
  const started = Date.now();
  await assert.rejects(session.waitForOutput(/never/, 5_000), /exited/);
  assert.ok(Date.now() - started < 2_000);
});
