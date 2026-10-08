import { redact } from '../core/redact.js';
import { tunnelError } from '../core/errors.js';
import type { TunnelError } from '../core/types.js';
import { runCommand } from './command-runner.js';
import { readCredentialsTunnelId } from './origin-cert.js';

export type Result<T> = { ok: true; value: T } | { ok: false; error: TunnelError };
export interface TunnelObservation { uuid: string; name: string; createdAt?: string; connections: number; }

export class CloudflaredAdapter {
  private readonly executable: string;
  private readonly baseArgs: string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly originCert?: string;

  /** `originCert` selects the Cloudflare account; without it cloudflared falls back to ~/.cloudflared/cert.pem. */
  constructor(options: { executable?: string; baseArgs?: string[]; env?: NodeJS.ProcessEnv; originCert?: string } = {}) {
    this.executable = options.executable ?? 'cloudflared';
    this.baseArgs = options.baseArgs ?? [];
    this.env = options.env ?? process.env;
    this.originCert = options.originCert;
  }

  private command(args: string[], timeoutMs = 30_000, extra: { env?: NodeJS.ProcessEnv; onOutput?: (chunk: string) => void } = {}) {
    return runCommand({ executable: this.executable, args: [...this.baseArgs, ...args], env: extra.env ?? this.env, timeoutMs, onOutput: extra.onOutput });
  }

  private tunnel(args: string[], timeoutMs?: number) {
    return this.command(['tunnel', ...(this.originCert ? ['--origincert', this.originCert] : []), ...args], timeoutMs);
  }

  private failure(result: { exitCode: number; stderr: string }, context: { hostname?: string } = {}): { ok: false; error: TunnelError } {
    const stderr = redact(result.stderr);
    if (/code: 1003|record with that host already exists/i.test(result.stderr)) return { ok: false, error: tunnelError('DNS_RECORD_EXISTS', { exitCode: result.exitCode, stderr, hostname: context.hostname }) };
    if (/origin cert(ificate)? path|locating origin cert|cert\.pem[^\n]*no such file|no such file[^\n]*cert\.pem|cannot find origin cert/i.test(result.stderr)) {
      return { ok: false, error: tunnelError('AUTH_REQUIRED', { exitCode: result.exitCode, stderr }) };
    }
    if (/authenticate|origin certificate/i.test(result.stderr) && /invalid|revoked|expired/i.test(result.stderr)) {
      return { ok: false, error: tunnelError('AUTH_STALE', { exitCode: result.exitCode, stderr }) };
    }
    return { ok: false, error: tunnelError('CLOUDFLARED_COMMAND_FAILED', { exitCode: result.exitCode, stderr }) };
  }

  async version(): Promise<Result<{ version: string }>> {
    const result = await this.command(['--version']);
    if (result.exitCode !== 0) return this.failure(result);
    const match = result.stdout.match(/cloudflared version\s+([^\s]+)/i);
    return match ? { ok: true, value: { version: match[1] } } : { ok: false, error: tunnelError('CLOUDFLARED_OUTPUT_UNRECOGNIZED', { stderr: result.stdout }) };
  }

  /**
   * `cloudflared tunnel login` always writes to $HOME/.cloudflared/cert.pem and has no output flag,
   * so callers pass an isolated `home` to keep the user's existing certificate untouched.
   */
  async login(options: { home?: string; onOutput?: (chunk: string) => void; timeoutMs?: number } = {}): Promise<Result<{ completed: true }>> {
    const env = options.home ? { ...this.env, HOME: options.home, USERPROFILE: options.home } : this.env;
    const result = await this.command(['tunnel', 'login'], options.timeoutMs ?? 180_000, { env, onOutput: options.onOutput });
    return result.exitCode === 0 ? { ok: true, value: { completed: true } } : this.failure(result);
  }

  async listTunnels(): Promise<Result<TunnelObservation[]>> {
    const result = await this.tunnel(['list', '--output', 'json']);
    if (result.exitCode !== 0) return this.failure(result);
    try {
      const rows = JSON.parse(result.stdout) as Array<{ id?: string; uuid?: string; name: string; createdAt?: string; connections?: unknown[] }>;
      return { ok: true, value: rows.map(row => ({ uuid: row.id ?? row.uuid ?? '', name: row.name, createdAt: row.createdAt, connections: row.connections?.length ?? 0 })).filter(row => row.uuid) };
    } catch {
      return { ok: false, error: tunnelError('CLOUDFLARED_OUTPUT_UNRECOGNIZED', { stderr: result.stdout }) };
    }
  }

  async createTunnel(name: string, options: { credentialsFile?: string } = {}): Promise<Result<{ uuid: string; credentialsFile: string }>> {
    const result = await this.tunnel(['create', ...(options.credentialsFile ? ['--credentials-file', options.credentialsFile] : []), name]);
    if (result.exitCode !== 0) return this.failure(result);
    const credentialsFile = options.credentialsFile ?? result.stdout.match(/(?:written to|credentials[^\n]*?)\s+([^\s]+\.json)/i)?.[1];
    // The output also prints the credentials path, which can itself contain a UUID (the account folder),
    // so trust the credentials file first, then the "Created tunnel ... with id" line.
    const uuid = (credentialsFile && readCredentialsTunnelId(credentialsFile))
      ?? result.stdout.match(/created tunnel .+ with id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1]
      ?? result.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
    if (!uuid || !credentialsFile) return { ok: false, error: tunnelError('CLOUDFLARED_OUTPUT_UNRECOGNIZED', { stderr: result.stdout }) };
    return { ok: true, value: { uuid, credentialsFile } };
  }

  async validateIngress(configPath: string): Promise<Result<{ valid: true }>> {
    const result = await this.command(['tunnel', '--config', configPath, 'ingress', 'validate']);
    return result.exitCode === 0 ? { ok: true, value: { valid: true } } : this.failure(result);
  }

  /** `overwrite` replaces an existing A/AAAA/CNAME record; callers only pass it after the user confirms. */
  async routeDns(tunnel: string, hostname: string, options: { overwrite?: boolean } = {}): Promise<Result<{ hostname: string }>> {
    const result = await this.tunnel(['route', 'dns', ...(options.overwrite ? ['--overwrite-dns'] : []), tunnel, hostname]);
    return result.exitCode === 0 ? { ok: true, value: { hostname } } : this.failure(result, { hostname });
  }

  async info(tunnel: string): Promise<Result<{ connectorState: 'healthy' | 'degraded' | 'disconnected' | 'unknown' }>> {
    const result = await this.tunnel(['info', '--output', 'json', tunnel]);
    if (result.exitCode !== 0) return this.failure(result);
    try {
      const value = JSON.parse(result.stdout) as { connections?: unknown[] };
      return { ok: true, value: { connectorState: value.connections?.length ? 'healthy' : 'disconnected' } };
    } catch {
      return { ok: false, error: tunnelError('CLOUDFLARED_OUTPUT_UNRECOGNIZED', { stderr: result.stdout }) };
    }
  }
}

export function runCloudflared(args: string[], timeoutMs = 120_000) {
  return runCommand({ executable: 'cloudflared', args, timeoutMs }).then(result => ({ code: result.exitCode, stdout: redact(result.stdout), stderr: redact(result.stderr) }));
}
