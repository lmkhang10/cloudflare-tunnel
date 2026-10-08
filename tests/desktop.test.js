import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ELECTRON_VERSION, cloudIconPng, runtimeStatus } from '../dist/index.js';

test('draws distinct PNG template icons for idle and running', () => {
  const idle = cloudIconPng(32); const running = cloudIconPng(32, { filled: true });
  assert.deepEqual([...idle.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(idle.readUInt32BE(16), 32);
  assert.notDeepEqual(idle, running);
});

test('reports the desktop runtime as missing, outdated, or current', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-runtime-'));
  assert.equal(runtimeStatus(root).installed, false);
  const electron = path.join(root, 'node_modules', 'electron');
  await mkdir(path.join(electron, 'dist', 'Electron.app', 'Contents', 'MacOS'), { recursive: true });
  await writeFile(path.join(electron, 'path.txt'), 'Electron.app/Contents/MacOS/Electron');
  await writeFile(path.join(electron, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'), '');
  await writeFile(path.join(electron, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  assert.deepEqual([runtimeStatus(root, 'darwin').installed, runtimeStatus(root, 'darwin').current], [true, false]);
  await writeFile(path.join(electron, 'package.json'), JSON.stringify({ version: ELECTRON_VERSION }));
  assert.equal(runtimeStatus(root, 'darwin').current, true);
  await rm(root, { recursive: true, force: true });
});

import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { bundleIsCurrent, installAppBundle, readBundleConfig, createServer } from '../dist/index.js';

test('builds a Dock-ready app bundle that records how to reach the CLI', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-bundle-'));
  const target = path.join(root, 'Applications', 'Cloudflare Tunnel Kit.app');
  const calls = [];
  const run = async (executable, args) => {
    calls.push([path.basename(executable), args[0]]);
    if (executable === 'cp') { mkdirSync(path.join(args[2], 'Contents', 'MacOS'), { recursive: true }); writeFileSync(path.join(args[2], 'Contents', 'MacOS', 'Electron'), ''); }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  const config = { version: '9.9.9', nodePath: '/bin/node', cliPath: '/lib/cli/main.js', dataDir: '/data' };
  await installAppBundle({ electronBinary: '/runtime/dist/Electron.app/Contents/MacOS/Electron', config, target, run });
  assert.deepEqual(calls[0], ['cp', '-cR']);
  assert.ok(calls.some(call => call[0] === 'plutil') && calls.some(call => call[0] === 'iconutil') && calls.some(call => call[0] === 'codesign'));
  assert.equal(readBundleConfig(target).cliPath, '/lib/cli/main.js');
  assert.match(await readFile(path.join(target, 'Contents', 'Resources', 'app', 'main.js'), 'utf8'), /CLOUDFLARE_TUNNEL_KIT_DATA_DIR \?\?= config\.dataDir/);
  assert.equal(bundleIsCurrent(config, target), true);
  assert.equal(bundleIsCurrent({ ...config, cliPath: '/elsewhere.js' }, target), false);
  await rm(root, { recursive: true, force: true });
});

test('serves the logo and favicon from the package assets', async () => {
  const server = createServer({});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/logo.png`);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(existsSync(new URL('../assets/favicon.png', import.meta.url)), true);
  } finally { server.close(); }
});
