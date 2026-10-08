import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LaunchdAutostart, createAutostartBackend, programArguments, renderLaunchAgentPlist } from '../dist/index.js';

const spec = { nodePath: '/opt/node & co/bin/node', cliPath: '/lib/cftunnel/dist/cli/main.js', logDir: '/data/logs', pathEnv: '/opt/homebrew/bin:/usr/bin:/bin', env: { CLOUDFLARE_TUNNEL_KIT_DATA_DIR: '/data' } };

test('renders a LaunchAgent with absolute paths, PATH, and restart-on-crash only', () => {
  const plist = renderLaunchAgentPlist(spec);
  assert.match(plist, /<string>vn\.cftunnel\.daemon<\/string>/);
  assert.deepEqual(programArguments(plist), [spec.nodePath, spec.cliPath, 'daemon', 'run']);
  assert.match(plist, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin:\/bin<\/string>/);
  assert.match(plist, /<key>CFTUNNEL_LAUNCHD<\/key>/);
  assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.match(plist, /node &amp; co/);
});

test('enables, reports stale paths, and disables through launchctl', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'cf-launchd-'));
  const calls = [];
  const run = async (executable, args) => { calls.push([executable, ...args]); return { exitCode: args[0] === 'print' ? 0 : 0, stdout: '', stderr: '' }; };
  const backend = new LaunchdAutostart({ home, uid: 501, run });
  const nodePath = path.join(home, 'node'); const cliPath = path.join(home, 'main.js');
  await writeFile(nodePath, ''); await writeFile(cliPath, '');
  const status = await backend.enable({ ...spec, nodePath, cliPath, logDir: path.join(home, 'logs') });
  assert.equal(status.enabled, true);
  assert.equal(status.stale, false);
  assert.deepEqual(calls.slice(0, 2), [['launchctl', 'bootout', 'gui/501/vn.cftunnel.daemon'], ['launchctl', 'bootstrap', 'gui/501', backend.file]]);
  assert.match(await readFile(backend.file, 'utf8'), /daemon<\/string>/);
  await rm(nodePath);
  const stale = await backend.status();
  assert.equal(stale.stale, true);
  assert.match(stale.detail, /missing node/);
  const disabled = await backend.disable();
  assert.equal(disabled.enabled, false);
  assert.equal(existsSync(backend.file), false);
  await rm(home, { recursive: true, force: true });
});

test('surfaces launchctl failures and unsupported platforms clearly', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'cf-launchd-fail-'));
  const backend = new LaunchdAutostart({ home, uid: 501, run: async (_e, args) => ({ exitCode: args[0] === 'bootstrap' ? 5 : 0, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error' }) });
  await assert.rejects(backend.enable({ ...spec, logDir: path.join(home, 'logs') }), /Input\/output error/);
  const linux = createAutostartBackend({ platform: 'linux' });
  assert.equal((await linux.status()).supported, false);
  await assert.rejects(linux.enable(spec), /not supported on linux/);
  await rm(home, { recursive: true, force: true });
});
