import path from 'node:path';
import { realpathSync } from 'node:fs';
import { runCommand } from '../providers/command-runner.js';

export type InstallKind = 'global' | 'local' | 'unknown';
type Runner = (executable: string, args: string[], timeoutMs?: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface UpdateState {
  current: string; latest?: string; available: boolean; checkedAt?: string; error?: string;
  installKind: InstallKind; installing: boolean; installCommand: string;
  cloudflared: { current?: string; latest?: string; available: boolean; hint?: string; path?: string };
}

/** Numeric comparison of dotted versions; pre-release suffixes sort before the release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => { const [core, pre] = value.replace(/^v/, '').split('-', 2); return { parts: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre }; };
  const left = parse(a), right = parse(b);
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length); index++) {
    const diff = (left.parts[index] ?? 0) - (right.parts[index] ?? 0); if (diff) return Math.sign(diff);
  }
  if (left.pre && !right.pre) return -1; if (!left.pre && right.pre) return 1;
  return 0;
}

export function cloudflaredUpgradeHint(executablePath?: string): string {
  let resolved = executablePath;
  try { if (executablePath) resolved = realpathSync(executablePath); } catch {}
  if (resolved && /\/(Cellar|homebrew|linuxbrew)\//i.test(resolved)) return 'brew upgrade cloudflared';
  return 'Download the latest release from https://github.com/cloudflare/cloudflared/releases/latest';
}

/**
 * Checks the public npm registry and GitHub releases. Requests carry no identifiers beyond a User-Agent.
 * Only global npm installs are updated in place; project-local installs are left for the user to bump.
 */
export class UpdateService {
  private readonly state: UpdateState;
  private readonly packageName: string; private readonly nodePath: string; private readonly cliPath: string;
  private readonly fetchImpl: typeof fetch; private readonly run: Runner;
  private readonly cloudflared: () => Promise<{ version?: string; path?: string }>;
  private installKindChecked = false;

  constructor(options: { packageName: string; currentVersion: string; nodePath: string; cliPath: string; fetchImpl?: typeof fetch; run?: Runner; cloudflared?: () => Promise<{ version?: string; path?: string }> }) {
    this.packageName = options.packageName; this.nodePath = options.nodePath; this.cliPath = options.cliPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.run = options.run ?? ((executable, args, timeoutMs) => runCommand({ executable, args, timeoutMs: timeoutMs ?? 30_000 }));
    this.cloudflared = options.cloudflared ?? (async () => ({}));
    this.state = { current: options.currentVersion, available: false, installKind: 'unknown', installing: false, installCommand: `npm install --global ${options.packageName}@latest`, cloudflared: { available: false } };
  }

  snapshot(): UpdateState { return { ...this.state, cloudflared: { ...this.state.cloudflared } }; }

  private npmPath(): string { return path.join(path.dirname(this.nodePath), process.platform === 'win32' ? 'npm.cmd' : 'npm'); }

  async detectInstallKind(): Promise<InstallKind> {
    if (this.installKindChecked) return this.state.installKind;
    this.installKindChecked = true;
    try {
      const result = await this.run(this.npmPath(), ['root', '--global'], 15_000);
      const root = realpathSync(result.stdout.trim());
      const cli = realpathSync(this.cliPath);
      this.state.installKind = result.exitCode === 0 && cli.startsWith(root + path.sep) ? 'global' : 'local';
    } catch { this.state.installKind = 'unknown'; }
    return this.state.installKind;
  }

  async check(): Promise<UpdateState> {
    await this.detectInstallKind();
    const [npm, github, local] = await Promise.allSettled([
      this.json(`https://registry.npmjs.org/${encodeURIComponent(this.packageName)}/latest`),
      this.json('https://api.github.com/repos/cloudflare/cloudflared/releases/latest'),
      this.cloudflared(),
    ]);
    this.state.checkedAt = new Date().toISOString();
    if (npm.status === 'fulfilled' && typeof npm.value?.version === 'string') {
      this.state.latest = npm.value.version; this.state.available = compareVersions(npm.value.version, this.state.current) > 0; this.state.error = undefined;
    } else this.state.error = `Could not reach the npm registry: ${npm.status === 'rejected' ? reason(npm.reason) : 'unexpected response'}`;
    const cloudflared = local.status === 'fulfilled' ? local.value : {};
    const latestCloudflared = github.status === 'fulfilled' && typeof github.value?.tag_name === 'string' ? github.value.tag_name.replace(/^v/, '') : undefined;
    this.state.cloudflared = {
      current: cloudflared.version, latest: latestCloudflared, path: cloudflared.path,
      available: Boolean(cloudflared.version && latestCloudflared && compareVersions(latestCloudflared, cloudflared.version) > 0),
      hint: cloudflaredUpgradeHint(cloudflared.path),
    };
    return this.snapshot();
  }

  /** Installs the latest version globally and proves the new CLI runs before reporting success. */
  async install(): Promise<{ version: string }> {
    if (this.state.installing) throw new Error('An update is already being installed.');
    if (await this.detectInstallKind() !== 'global') throw new Error(`This copy of cftunnel is not a global npm install. Update it with: ${this.state.installCommand}`);
    if (!this.state.latest) await this.check();
    const version = this.state.latest;
    if (!version || !this.state.available) throw new Error('cftunnel is already up to date.');
    this.state.installing = true;
    try {
      const installed = await this.run(this.npmPath(), ['install', '--global', '--no-audit', '--no-fund', `${this.packageName}@${version}`], 5 * 60_000);
      if (installed.exitCode !== 0) throw new Error(`npm install failed: ${(installed.stderr || installed.stdout).trim().split('\n').slice(-3).join(' ')}`);
      const verified = await this.run(this.nodePath, [this.cliPath, '--version'], 30_000);
      if (verified.exitCode !== 0 || verified.stdout.trim() !== version) throw new Error(`The installed CLI did not report version ${version}. The running service was left unchanged.`);
      this.state.current = version; this.state.available = false;
      return { version };
    } finally { this.state.installing = false; }
  }

  private async json(url: string): Promise<any> {
    const response = await this.fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': `${this.packageName}/${this.state.current}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
}

function reason(error: unknown): string { return error instanceof Error ? error.message : String(error); }
