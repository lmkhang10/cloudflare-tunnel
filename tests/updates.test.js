import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpdateService, compareVersions, cloudflaredUpgradeHint } from '../dist/index.js';

test('compares dotted versions including pre-releases', () => {
  assert.equal(compareVersions('0.1.13', '0.1.12'), 1);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('v2026.9.1', '2026.9.1'), 0);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
});

test('suggests brew for Homebrew cloudflared and a download link otherwise', () => {
  assert.equal(cloudflaredUpgradeHint('/opt/homebrew/Cellar/cloudflared/2026.6.0/bin/cloudflared'), 'brew upgrade cloudflared');
  assert.match(cloudflaredUpgradeHint('/usr/local/bin/cloudflared-unmanaged'), /github\.com\/cloudflare\/cloudflared/);
});

async function harness({ latest = '0.2.0', verifyVersion = latest, global = true, failInstall = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-updates-'));
  const npmRoot = path.join(root, 'lib', 'node_modules'); const cliPath = path.join(global ? npmRoot : root, 'cloudflare-tunnel-kit', 'main.js');
  await mkdir(path.dirname(cliPath), { recursive: true }); await writeFile(cliPath, '');
  const calls = [];
  const run = async (executable, args) => {
    calls.push([path.basename(executable), ...args]);
    if (args[0] === 'root') return { exitCode: 0, stdout: `${npmRoot}\n`, stderr: '' };
    if (args[0] === 'install') return { exitCode: failInstall ? 1 : 0, stdout: '', stderr: failInstall ? 'EACCES: permission denied' : '' };
    if (args[1] === '--version') return { exitCode: 0, stdout: `${verifyVersion}\n`, stderr: '' };
    return { exitCode: 1, stdout: '', stderr: '' };
  };
  const fetchImpl = async url => ({ ok: true, json: async () => url.includes('registry.npmjs.org') ? { version: latest } : { tag_name: '2026.9.0' } });
  const service = new UpdateService({ packageName: 'cloudflare-tunnel-kit', currentVersion: '0.1.12', nodePath: path.join(root, 'bin', 'node'), cliPath, fetchImpl, run, cloudflared: async () => ({ version: '2026.6.0', path: '/opt/homebrew/Cellar/cloudflared/bin/cloudflared' }) });
  return { root, service, calls, dispose: () => rm(root, { recursive: true, force: true }) };
}

test('detects a newer release for a global install and a newer cloudflared', async () => {
  const h = await harness();
  const state = await h.service.check();
  assert.equal(state.available, true);
  assert.equal(state.latest, '0.2.0');
  assert.equal(state.installKind, 'global');
  assert.equal(state.cloudflared.available, true);
  assert.equal(state.cloudflared.hint, 'brew upgrade cloudflared');
  await h.dispose();
});

test('installs globally and verifies the new CLI before reporting success', async () => {
  const h = await harness();
  await h.service.check();
  assert.deepEqual(await h.service.install(), { version: '0.2.0' });
  assert.deepEqual(h.calls.find(call => call[1] === 'install'), ['npm', 'install', '--global', '--no-audit', '--no-fund', 'cloudflare-tunnel-kit@0.2.0']);
  await h.dispose();
});

test('refuses local installs and reports install or verification failures', async () => {
  const local = await harness({ global: false });
  await local.service.check();
  await assert.rejects(local.service.install(), /not a global npm install/);
  await local.dispose();
  const broken = await harness({ verifyVersion: '0.1.12' });
  await broken.service.check();
  await assert.rejects(broken.service.install(), /left unchanged/);
  await broken.dispose();
  const denied = await harness({ failInstall: true });
  await denied.service.check();
  await assert.rejects(denied.service.install(), /EACCES/);
  await denied.dispose();
});

test('keeps working offline', async () => {
  const service = new UpdateService({ packageName: 'x', currentVersion: '1.0.0', nodePath: '/nope/node', cliPath: '/nope/cli.js', fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); }, run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) });
  const state = await service.check();
  assert.equal(state.available, false);
  assert.match(state.error, /ENOTFOUND/);
});
