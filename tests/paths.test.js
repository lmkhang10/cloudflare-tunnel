import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveAppPaths } from '../dist/index.js';

test('uses Application Support on macOS', () => {
  const paths = resolveAppPaths({ platform: 'darwin', home: '/Users/alice', env: {} });
  assert.equal(paths.dataDir, '/Users/alice/Library/Application Support/cloudflare-tunnel-kit');
  assert.equal(paths.database, path.join(paths.dataDir, 'state.db'));
  assert.equal(paths.projectsDir, path.join(paths.dataDir, 'projects'));
});

test('honors XDG_DATA_HOME on Linux', () => {
  const paths = resolveAppPaths({ platform: 'linux', home: '/home/alice', env: { XDG_DATA_HOME: '/data' } });
  assert.equal(paths.dataDir, '/data/cloudflare-tunnel-kit');
});

test('uses LOCALAPPDATA on Windows', () => {
  const paths = resolveAppPaths({ platform: 'win32', home: 'C:\\Users\\Alice', env: { LOCALAPPDATA: 'C:\\Local' } });
  assert.match(paths.dataDir, /Local.*cloudflare-tunnel-kit/);
});

test('fails instead of writing to an unknown broad location', () => {
  assert.throws(() => resolveAppPaths({ platform: 'linux', home: '', env: {} }), /home directory/);
});
