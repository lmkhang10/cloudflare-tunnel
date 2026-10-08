import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import type { AutostartBackend, AutostartSpec, AutostartStatus, Runner } from './index.js';

export const LAUNCHD_LABEL = 'vn.cftunnel.daemon';

const xml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);

export function renderLaunchAgentPlist(spec: AutostartSpec, label = LAUNCHD_LABEL): string {
  const env = { PATH: spec.pathEnv, CFTUNNEL_LAUNCHD: '1', ...(spec.env ?? {}) };
  const strings = (values: string[]) => values.map(value => `    <string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings([spec.nodePath, spec.cliPath, 'daemon', 'run'])}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(path.join(spec.logDir, 'launchd.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(path.join(spec.logDir, 'launchd.err.log'))}</string>
</dict>
</plist>
`;
}

/** Reads ProgramArguments back so status can detect a node or CLI path that no longer exists (nvm/fnm upgrades). */
export function programArguments(plist: string): string[] {
  const array = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  return [...array.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(match => match[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name]));
}

export class LaunchdAutostart implements AutostartBackend {
  readonly file: string;
  private readonly domain: string;
  private readonly run: Runner;

  constructor(options: { home: string; uid: number; run: Runner; label?: string }) {
    this.file = path.join(options.home, 'Library', 'LaunchAgents', `${options.label ?? LAUNCHD_LABEL}.plist`);
    this.domain = `gui/${options.uid}`; this.run = options.run;
  }

  private get target(): string { return `${this.domain}/${LAUNCHD_LABEL}`; }

  async status(): Promise<AutostartStatus> {
    if (!existsSync(this.file)) return { supported: true, enabled: false, loaded: false, stale: false, detail: 'Launch at login is off.', file: this.file };
    const [nodePath, cliPath] = programArguments(readFileSync(this.file, 'utf8'));
    const missing = [nodePath, cliPath].filter(item => !item || !existsSync(item));
    const loaded = (await this.run('launchctl', ['print', this.target])).exitCode === 0;
    const stale = missing.length > 0;
    const detail = stale ? `Launch at login points to a missing ${missing.map(item => item ? path.basename(item) : 'path').join(' and ')}. Repair it to use the current installation.`
      : loaded ? 'Launch at login is on. The background service is registered with launchd.' : 'Launch at login is on and will start at next login.';
    return { supported: true, enabled: true, loaded, stale, detail, file: this.file };
  }

  async enable(spec: AutostartSpec): Promise<AutostartStatus> {
    mkdirSync(path.dirname(this.file), { recursive: true });
    mkdirSync(spec.logDir, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, renderLaunchAgentPlist(spec), { mode: 0o644 }); renameSync(temporary, this.file);
    await this.run('launchctl', ['bootout', this.target]);
    const result = await this.run('launchctl', ['bootstrap', this.domain, this.file]);
    if (result.exitCode !== 0) throw new Error(`launchctl could not register the background service: ${(result.stderr || result.stdout).trim() || `exit ${result.exitCode}`}`);
    return this.status();
  }

  async disable(): Promise<AutostartStatus> {
    // bootout also stops a launchd-managed daemon; the daemon stops its connectors on SIGTERM.
    await this.run('launchctl', ['bootout', this.target]);
    rmSync(this.file, { force: true });
    return this.status();
  }

  async kickstart(): Promise<boolean> {
    if (!existsSync(this.file)) return false;
    if ((await this.run('launchctl', ['print', this.target])).exitCode !== 0) {
      if ((await this.run('launchctl', ['bootstrap', this.domain, this.file])).exitCode !== 0) return false;
    }
    return (await this.run('launchctl', ['kickstart', this.target])).exitCode === 0;
  }
}
