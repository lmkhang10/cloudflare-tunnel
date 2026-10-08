import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDaemon, findDaemon, openStateDatabase, readDaemonInfo, remoteService, runDaemon, StateStore, writeDaemonInfo } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./helpers/fake-cloudflared.js', import.meta.url));

test('ignores a stale daemon record whose process is gone', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'cf-lock-'));
  writeDaemonInfo(dataDir, { pid: 999_999, port: 1, token: 't', version: '0', startedAt: 'x', url: 'http://127.0.0.1:1' });
  assert.equal(readDaemonInfo(dataDir).pid, 999_999);
  assert.equal(await findDaemon(dataDir), undefined);
  await rm(dataDir, { recursive: true, force: true });
});

test('runs in the background, restores auto-start projects, closes stale sessions, and stops connectors on shutdown', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'cf-daemon-'));
  const origin = httpServer((_req, res) => res.end('ok'));
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve));
  const localUrl = `http://127.0.0.1:${origin.address().port}`;
  const wrapper = path.join(dataDir, 'cloudflared');
  await writeFile(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`); await chmod(wrapper, 0o755);

  const db = openStateDatabase(path.join(dataDir, 'state.db'));
  const store = new StateStore(db);
  const project = store.saveProject({ displayName: 'Shop', path: dataDir, profile: 'custom' });
  store.saveTunnel({ projectId: project.id, kind: 'quick', localUrl });
  store.setProjectAutoStart(project.id, true);
  const stale = store.saveProject({ displayName: 'Stale', path: path.join(dataDir, 'gone'), profile: 'custom' });
  store.saveSession({ projectId: stale.id, processKey: 'quick:stale', state: 'running' });
  store.saveSettings({ cloudflaredPath: wrapper });
  db.close();

  const previous = process.env.FAKE_CLOUDFLARED_SCENARIO; process.env.FAKE_CLOUDFLARED_SCENARIO = 'quick-running';
  const exited = runDaemon({ dataDir, version: '9.9.9', nodePath: process.execPath, cliPath: '/unused/main.js', port: 0, tray: false });
  try {
    let client;
    for (let attempt = 0; attempt < 100 && !client; attempt++) { client = await connectDaemon(dataDir); if (!client) await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.ok(client, 'daemon answered');
    assert.equal(client.info.version, '9.9.9');
    const service = remoteService(client);
    let projects;
    for (let attempt = 0; attempt < 100; attempt++) { projects = await service.listProjects(); if (projects.find(p => p.id === project.id)?.status === 'Running') break; await new Promise(resolve => setTimeout(resolve, 50)); }
    const restored = projects.find(p => p.id === project.id);
    assert.equal(restored.status, 'Running');
    assert.match(restored.publicUrl, /trycloudflare\.com/);
    const settings = await client.get('/api/settings');
    assert.equal(settings.values.cloudflaredPath, wrapper);
    assert.ok((await client.get('/api/events')).events.some(event => event.type === 'quick-url'));

    await client.post('/api/daemon/shutdown', { resume: true });
    assert.equal(await exited, 0);
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'resume.json'), 'utf8')).projectIds, [project.id], 'restart remembers running tunnels');
    assert.equal(existsSync(path.join(dataDir, 'daemon.json')), false);
    const reopened = openStateDatabase(path.join(dataDir, 'state.db'));
    const after = new StateStore(reopened);
    assert.equal(after.listOpenSessions().length, 0, 'every session is closed after shutdown');
    reopened.close();
    assert.match(await readFile(path.join(dataDir, 'logs', 'daemon.log'), 'utf8'), /Closed 1 connector session/);
  } finally {
    if (previous === undefined) delete process.env.FAKE_CLOUDFLARED_SCENARIO; else process.env.FAKE_CLOUDFLARED_SCENARIO = previous;
    origin.close(); await rm(dataDir, { recursive: true, force: true });
  }
});
