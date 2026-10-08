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
