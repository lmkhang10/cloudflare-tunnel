import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import packageJson from '../package.json' with { type: 'json' };
import { launchBrowser } from '../dist/index.js';

const exec = promisify(execFile);

test('CLI help reports the package version and consumer-safe invocation', async () => {
  const { stdout } = await exec(process.execPath, ['dist/cli/main.js', '--help']);
  assert.match(stdout, new RegExp(`cloudflare-tunnel-kit ${packageJson.version.replaceAll('.', '\\.')}`));
  assert.match(stdout, /npx cf-tunnel ui/);
});

test('browser launcher chooses the platform command with the UI URL as one argument', async () => {
  const calls = [];
  const result = await launchBrowser('http://127.0.0.1:4567', {
    platform: 'darwin',
    run: async (executable, args) => { calls.push([executable, args]); return { exitCode: 0 }; },
  });
  assert.equal(result.opened, true);
  assert.deepEqual(calls, [['open', ['http://127.0.0.1:4567']]]);
});

test('browser launcher returns a usable fallback instead of throwing', async () => {
  const result = await launchBrowser('http://127.0.0.1:4567', {
    platform: 'linux',
    run: async () => ({ exitCode: 1 }),
  });
  assert.equal(result.opened, false);
  assert.match(result.message, /Open this URL manually/);
});
