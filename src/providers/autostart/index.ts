import os from 'node:os';
import { runCommand } from '../command-runner.js';
import { LaunchdAutostart } from './launchd.js';

export interface AutostartSpec {
  nodePath: string;
  cliPath: string;
  logDir: string;
  /** PATH for the background service; launchd starts agents with only /usr/bin:/bin:/usr/sbin:/sbin. */
  pathEnv: string;
  /** Extra environment for the service, such as CLOUDFLARE_TUNNEL_KIT_DATA_DIR. */
  env?: Record<string, string>;
}

export interface AutostartStatus { supported: boolean; enabled: boolean; loaded: boolean; stale: boolean; detail: string; file?: string; }

export interface AutostartBackend {
  status(): Promise<AutostartStatus>;
  enable(spec: AutostartSpec): Promise<AutostartStatus>;
  disable(): Promise<AutostartStatus>;
  /** Starts the registered service now; returns false when no service is registered. */
  kickstart(): Promise<boolean>;
}

export type Runner = (executable: string, args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export function createAutostartBackend(options: { platform?: string; home?: string; uid?: number; run?: Runner } = {}): AutostartBackend {
  const platform = options.platform ?? process.platform;
  const run: Runner = options.run ?? ((executable, args) => runCommand({ executable, args, timeoutMs: 15_000 }));
  if (platform === 'darwin') return new LaunchdAutostart({ home: options.home ?? os.homedir(), uid: options.uid ?? process.getuid?.() ?? 0, run });
  return new UnsupportedAutostart(platform);
}

export class UnsupportedAutostart implements AutostartBackend {
  constructor(private readonly platform: string) {}
  private message(): string { return `Launch at login is not supported on ${this.platform} yet. Start the service with \`cftunnel daemon start\`.`; }
  async status(): Promise<AutostartStatus> { return { supported: false, enabled: false, loaded: false, stale: false, detail: this.message() }; }
  async enable(): Promise<AutostartStatus> { throw new Error(this.message()); }
  async disable(): Promise<AutostartStatus> { return this.status(); }
  async kickstart(): Promise<boolean> { return false; }
}
