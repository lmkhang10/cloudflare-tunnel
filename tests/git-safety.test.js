import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectGitSafety, applyLocalExclude } from '../dist/index.js';

const exec = promisify(execFile);
async function git(root, args) { return exec('git', ['-C', root, ...args]); }
async function makeGitRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-git-'));
  await git(root, ['init']);
  return root;
}

test('warns when cert.pem is staged without reading its contents', async () => {
  const repo = await makeGitRepo();
  await writeFile(path.join(repo, 'cert.pem'), 'sensitive fixture');
  await git(repo, ['add', 'cert.pem']);
  const result = await inspectGitSafety(repo);
  assert.equal(result.issues[0].code, 'GIT_SENSITIVE_FILE_TRACKED');
  assert.equal(result.issues[0].paths.includes('cert.pem'), true);
  await rm(repo, { recursive: true, force: true });
});

test('adds one local exclude without touching .gitignore', async () => {
  const repo = await makeGitRepo();
  await applyLocalExclude(repo, '.cloudflare-tunnel-kit/');
  await applyLocalExclude(repo, '.cloudflare-tunnel-kit/');
  const exclude = await readFile(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter(line => line === '.cloudflare-tunnel-kit/').length, 1);
  await assert.rejects(readFile(path.join(repo, '.gitignore')));
  await rm(repo, { recursive: true, force: true });
});
