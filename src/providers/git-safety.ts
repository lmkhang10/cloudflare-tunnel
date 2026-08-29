import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './command-runner.js';

export interface GitSafetyIssue { code: 'GIT_SENSITIVE_FILE_TRACKED'; reason: string; fix: string; paths: string[]; }
export interface GitSafetyResult { repository: boolean; root?: string; issues: GitSafetyIssue[]; }

async function git(root: string, args: string[]) {
  return runCommand({ executable: 'git', args: ['-C', root, ...args], timeoutMs: 10_000 });
}

function sensitive(file: string): boolean {
  const name = path.basename(file).toLowerCase();
  return name === 'cert.pem'
    || /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i.test(name)
    || /\.(key|p12|pfx)$/i.test(name)
    || file.split(/[\\/]/).includes('.cloudflare-tunnel-kit');
}

export async function inspectGitSafety(candidate: string): Promise<GitSafetyResult> {
  const rootResult = await git(candidate, ['rev-parse', '--show-toplevel']);
  if (rootResult.exitCode !== 0) return { repository: false, issues: [] };
  const root = rootResult.stdout.trim();
  const [trackedResult, stagedResult] = await Promise.all([
    git(root, ['ls-files']),
    git(root, ['diff', '--cached', '--name-only']),
  ]);
  const files = new Set([...trackedResult.stdout.split('\n'), ...stagedResult.stdout.split('\n')].map(value => value.trim()).filter(Boolean));
  const paths = [...files].filter(sensitive).sort();
  return {
    repository: true,
    root,
    issues: paths.length ? [{
      code: 'GIT_SENSITIVE_FILE_TRACKED',
      reason: 'Git is tracking or staging a Cloudflare credential or generated tunnel file.',
      fix: 'Remove the file from Git tracking and rotate any credential that may already have been shared.',
      paths,
    }] : [],
  };
}

export async function applyLocalExclude(repository: string, rule: string): Promise<void> {
  if (!rule.trim() || /[\r\n]/.test(rule)) throw new Error('A local Git exclude rule must be one non-empty line.');
  const locationResult = await git(repository, ['rev-parse', '--git-path', 'info/exclude']);
  if (locationResult.exitCode !== 0) throw new Error('The selected project is not a Git repository.');
  const location = path.resolve(repository, locationResult.stdout.trim());
  let content = '';
  try { content = await readFile(location, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const lines = content.split(/\r?\n/);
  if (lines.includes(rule)) return;
  const next = `${content}${content && !content.endsWith('\n') ? '\n' : ''}${rule}\n`;
  const temporary = `${location}.cloudflare-tunnel-kit.tmp`;
  await writeFile(temporary, next, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, location);
}
