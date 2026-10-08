import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { launcherMenu, mainMenu } from '../dist/cli/wizard.js';

test('terminal wizard presents the four primary English choices', () => {
  const output = mainMenu();
  assert.match(output, /Create a Quick Tunnel/);
  assert.match(output, /Set up a custom domain/);
  assert.match(output, /Open a saved project/);
  assert.match(output, /Check system requirements/);
});

test('bare cftunnel offers the app, the browser dashboard, and the terminal wizard', () => {
  const output = launcherMenu();
  assert.match(output, /1\. Open the app \(menu bar icon \+ window\)/);
  assert.match(output, /2\. Open the dashboard in your browser/);
  assert.match(output, /3\. Use the terminal wizard/);
});

test('non-interactive invocation does not hang when input is missing', async () => {
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['dist/cli/main.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => stdout += value);
    child.stderr.on('data', value => stderr += value);
    child.on('close', code => resolve({ code, output: stdout + stderr }));
  });
  assert.equal(result.code, 2);
  assert.match(result.output, /INTERACTIVE_INPUT_REQUIRED/);
  assert.match(result.output, /npx cf-tunnel ui/);
});

test('CLI help documents configurable loopback UI ports', async () => {
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['dist/cli/main.js', 'help'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', value => output += value);
    child.stderr.on('data', value => output += value);
    child.on('close', code => resolve({ code, output }));
  });
  assert.equal(result.code, 0);
  assert.match(result.output, /--port PORT/);
  assert.match(result.output, /CLOUDFLARE_TUNNEL_KIT_UI_PORT/);
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, writeDaemonInfo } from '../dist/index.js';
import packageJson from '../package.json' with { type: 'json' };

function runCli(args, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['dist/cli/main.js', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
    child.on('close', code => resolve({ code, output }));
  });
}

test('prints the bare version for update verification', async () => {
  const result = await runCli(['--version']);
  assert.equal(result.output.trim(), packageJson.version);
});

test('routes lifecycle commands to the running background service', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'cf-cli-daemon-'));
  const calls = [];
  const service = { getProject: async id => { calls.push(['status', id]); return { id, via: 'daemon' }; }, stop: async id => { calls.push(['stop', id]); } };
  const server = createServer({ service, sessionToken: 'cli-token', version: 'test', daemon: { pid: process.pid, startedAt: 'now', shutdown: async () => ({}), installUpdate: async () => ({}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  writeDaemonInfo(dataDir, { pid: process.pid, port, token: 'cli-token', version: 'test', startedAt: 'now', url: `http://127.0.0.1:${port}` });
  try {
    const status = await runCli(['status', '--project', 'p1'], { CLOUDFLARE_TUNNEL_KIT_DATA_DIR: dataDir });
    assert.equal(status.code, 0, status.output);
    assert.match(status.output, /"via": "daemon"/);
    await runCli(['stop', '--project', 'p1'], { CLOUDFLARE_TUNNEL_KIT_DATA_DIR: dataDir });
    assert.deepEqual(calls, [['status', 'p1'], ['stop', 'p1']]);
  } finally { server.close(); await rm(dataDir, { recursive: true, force: true }); }
});

test('validates settings from the command line', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'cf-cli-settings-'));
  try {
    const bad = await runCli(['settings', 'set', 'protocol', 'udp'], { CLOUDFLARE_TUNNEL_KIT_DATA_DIR: dataDir });
    assert.equal(bad.code, 1); assert.match(bad.output, /auto, quic, http2/);
    const good = await runCli(['settings', 'set', 'protocol', 'http2'], { CLOUDFLARE_TUNNEL_KIT_DATA_DIR: dataDir });
    assert.equal(good.code, 0); assert.match(good.output, /"protocol": "http2"/);
  } finally { await rm(dataDir, { recursive: true, force: true }); }
});
