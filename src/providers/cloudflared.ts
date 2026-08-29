import { redact } from '../core/redact.js';
import { tunnelError } from '../core/errors.js';
import type { TunnelError } from '../core/types.js';
import { runCommand } from './command-runner.js';

export type Result<T> = { ok: true; value: T } | { ok: false; error: TunnelError };
export interface TunnelObservation { uuid: string; name: string; createdAt?: string; connections: number; }

export class CloudflaredAdapter {
  private readonly executable: string;
  private readonly baseArgs: string[];
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: { executable?: string; baseArgs?: string[]; env?: NodeJS.ProcessEnv } = {}) {
    this.executable = options.executable ?? 'cloudflared';
    this.baseArgs = options.baseArgs ?? [];
    this.env = options.env ?? process.env;
  }

  private command(args: string[], timeoutMs = 30_000) {
    return runCommand({ executable: this.executable, args: [...this.baseArgs, ...args], env: this.env, timeoutMs });
  }

  private failure(result: { exitCode: number; stderr: string }): { ok: false; error: TunnelError } {
    const stderr = redact(result.stderr);
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

  async login(): Promise<Result<{ completed: true }>> {
    const result = await this.command(['tunnel', 'login'], 180_000);
    return result.exitCode === 0 ? { ok: true, value: { completed: true } } : this.failure(result);
  }

  async listTunnels(): Promise<Result<TunnelObservation[]>> {
    const result = await this.command(['tunnel', 'list', '--output', 'json']);
    if (result.exitCode !== 0) return this.failure(result);
    try {
      const rows = JSON.parse(result.stdout) as Array<{ id?: string; uuid?: string; name: string; createdAt?: string; connections?: unknown[] }>;
      return { ok: true, value: rows.map(row => ({ uuid: row.id ?? row.uuid ?? '', name: row.name, createdAt: row.createdAt, connections: row.connections?.length ?? 0 })).filter(row => row.uuid) };
    } catch {
      return { ok: false, error: tunnelError('CLOUDFLARED_OUTPUT_UNRECOGNIZED', { stderr: result.stdout }) };
    }
  }

  async createTunnel(name: string): Promise<Result<{ uuid: string; credentialsFile: string }>> {
    const result = await this.command(['tunnel', 'create', name]);
    if (result.exitCode !== 0) return this.failure(result);
    const uuid = result.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
    const credentialsFile = result.stdout.match(/(?:written to|credentials[^\n]*?)\s+([^\s]+\.json)/i)?.[1];
    if (!uuid || !credentialsFile) return { ok: false, error: tunnelError('CLOUDFLARED_OUTPUT_UNRECOGNIZED', { stderr: result.stdout }) };
    return { ok: true, value: { uuid, credentialsFile } };
  }

  async validateIngress(configPath: string): Promise<Result<{ valid: true }>> {
    const result = await this.command(['tunnel', 'ingress', 'validate', '--config', configPath]);
    return result.exitCode === 0 ? { ok: true, value: { valid: true } } : this.failure(result);
  }

  async routeDns(tunnel: string, hostname: string): Promise<Result<{ hostname: string }>> {
    const result = await this.command(['tunnel', 'route', 'dns', tunnel, hostname]);
    return result.exitCode === 0 ? { ok: true, value: { hostname } } : this.failure(result);
  }

  async info(tunnel: string): Promise<Result<{ connectorState: 'healthy' | 'degraded' | 'disconnected' | 'unknown' }>> {
    const result = await this.command(['tunnel', 'info', tunnel, '--output', 'json']);
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
