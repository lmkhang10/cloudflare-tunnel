import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccountService, CloudflaredAdapter, StateStore, openStateDatabase, parseOriginCert } from '../dist/index.js';

const fixture = fileURLToPath(new URL('./helpers/fake-cloudflared.js', import.meta.url));
const fakeCert = account => `-----BEGIN ARGO TUNNEL TOKEN-----\n${Buffer.from(JSON.stringify({ zoneID: 'b'.repeat(32), accountID: account, apiToken: 'secret-api-token' })).toString('base64')}\n-----END ARGO TUNNEL TOKEN-----\n`;

async function harness(scenario = 'success') {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-accounts-'));
  const cloudflaredHome = path.join(root, 'home', '.cloudflared');
  await mkdir(cloudflaredHome, { recursive: true });
  const db = openStateDatabase(path.join(root, 'state.db'));
  const store = new StateStore(db);
  const record = path.join(root, 'argv.jsonl');
  const adapterFor = originCert => new CloudflaredAdapter({ executable: process.execPath, baseArgs: [fixture], originCert, env: { ...process.env, FAKE_CLOUDFLARED_SCENARIO: scenario, FAKE_CLOUDFLARED_RECORD: record, FAKE_CERT_ACCOUNT: 'd'.repeat(32) } });
  const accounts = new AccountService({ store, accountsDir: path.join(root, 'accounts'), cloudflaredHome, adapterFor });
  return { root, db, store, accounts, cloudflaredHome, record, dispose: async () => { db.close(); await rm(root, { recursive: true, force: true }); } };
}

test('reads the account identity from an origin certificate without exposing the API token', () => {
  const identity = parseOriginCert(fakeCert('a'.repeat(32)));
  assert.deepEqual(identity, { accountTag: 'a'.repeat(32), zoneId: 'b'.repeat(32) });
  assert.deepEqual(parseOriginCert('not a certificate'), {});
});

test('discovers renamed certificates and imports copies without touching the originals', async () => {
  const h = await harness();
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem'), fakeCert('a'.repeat(32)));
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem.truyenfox'), fakeCert('e'.repeat(32)));
  await writeFile(path.join(h.cloudflaredHome, 'not-a-cert.json'), '{}');
  const candidates = h.accounts.discover();
  assert.deepEqual(candidates.map(c => [c.fileName, c.suggestedLabel, c.accountTag]), [['cert.pem', 'default', 'a'.repeat(32)], ['cert.pem.truyenfox', 'truyenfox', 'e'.repeat(32)]]);
  const account = h.accounts.importCandidate('cert.pem.truyenfox');
  assert.equal(account.label, 'truyenfox');
  assert.equal((await stat(account.certPath)).mode & 0o777, 0o600);
  assert.equal(await readFile(path.join(h.cloudflaredHome, 'cert.pem.truyenfox'), 'utf8'), fakeCert('e'.repeat(32)));
  assert.equal(h.accounts.importCandidate('cert.pem.truyenfox').id, account.id, 'importing twice reuses the account');
  assert.throws(() => h.accounts.importCandidate('../state.db'), /not found/);
  await h.dispose();
});

test('signs in with an isolated HOME so ~/.cloudflared/cert.pem is never replaced', async () => {
  const h = await harness();
  const original = fakeCert('a'.repeat(32));
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem'), original);
  const job = h.accounts.startLogin({ label: 'client' });
  const done = await h.accounts.waitForLogin(job.id, 20);
  assert.equal(done.state, 'succeeded');
  assert.match(done.loginUrl, /^https:\/\/dash\.cloudflare\.com\/argotunnel/);
  const account = h.store.getAccount(done.accountId);
  assert.equal(account.label, 'client');
  assert.equal(account.accountTag, 'd'.repeat(32));
  assert.match(await readFile(account.certPath, 'utf8'), /ARGO TUNNEL TOKEN/);
  assert.equal(await readFile(path.join(h.cloudflaredHome, 'cert.pem'), 'utf8'), original);
  await h.dispose();
});

test('reports a failed sign-in and verifies accounts with their own certificate', async () => {
  const failing = await harness('login-fails');
  const job = await failing.accounts.waitForLogin(failing.accounts.startLogin().id, 20);
  assert.equal(job.state, 'failed');
  await failing.dispose();

  const h = await harness();
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem.work'), fakeCert('a'.repeat(32)));
  const account = h.accounts.importCandidate('cert.pem.work');
  const verified = await h.accounts.verify(account.id);
  assert.equal(verified.ok, true);
  assert.equal(verified.status, 'ok');
  const calls = (await readFile(h.record, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(calls.at(-1), ['tunnel', '--origincert', account.certPath, 'list', '--output', 'json']);
  await h.dispose();
});

test('links legacy tunnels by credential AccountTag and blocks removing an account in use', async () => {
  const h = await harness();
  const credentials = path.join(h.root, 'legacy.json');
  await writeFile(credentials, JSON.stringify({ AccountTag: 'a'.repeat(32), TunnelSecret: 'secret' }));
  const project = h.store.saveProject({ displayName: 'Legacy', path: h.root, profile: 'custom' });
  const tunnel = h.store.saveTunnel({ projectId: project.id, kind: 'named', name: 'legacy', uuid: '33333333-3333-4333-8333-333333333333', credentialsPath: credentials });
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem'), fakeCert('a'.repeat(32)));
  const account = h.accounts.importCandidate('cert.pem');
  assert.equal(h.store.getTunnelForProject(project.id).accountId, account.id);
  assert.throws(() => h.accounts.remove(account.id), /still use/);
  h.store.removeProject(project.id);
  h.accounts.remove(account.id);
  assert.deepEqual(h.store.listAccounts(), []);
  assert.ok(tunnel.id);
  await h.dispose();
});

test('treats cert.pem as the same account as a renamed copy and prefers the named label', async () => {
  const h = await harness();
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem'), fakeCert('a'.repeat(32)));
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem.taixechuyen'), fakeCert('a'.repeat(32)));
  await writeFile(path.join(h.cloudflaredHome, 'cert.pem.truyenfox'), fakeCert('e'.repeat(32)));
  assert.equal(h.accounts.discover().find(c => c.fileName === 'cert.pem').duplicateOf, 'cert.pem.taixechuyen');
  const imported = h.accounts.importAll();
  assert.deepEqual(imported.map(a => a.label).sort(), ['taixechuyen', 'truyenfox']);
  await h.dispose();
});
