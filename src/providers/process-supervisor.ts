import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { redact } from '../core/redact.js';

export type ManagedProcessState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export class ManagedSession {
  state: ManagedProcessState = 'starting';
  readonly startedAt = new Date().toISOString();
  readonly pid?: number;
  private logText = '';
  private readonly events = new EventEmitter();

  constructor(readonly key: string, readonly child: ChildProcess, private readonly maxLogBytes: number) {
    this.pid = child.pid;
  }

  append(value: string): void {
    this.logText = Buffer.from(this.logText + redact(value)).subarray(-this.maxLogBytes).toString('utf8');
    this.events.emit('output', this.logText);
  }

  logs(): string { return this.logText; }

  waitForOutput(pattern: RegExp, timeoutMs: number): Promise<string> {
    if (pattern.test(this.logText)) return Promise.resolve(this.logText);
    return new Promise((resolve, reject) => {
      const output = (logs: string) => {
        if (!pattern.test(logs)) return;
        cleanup(); resolve(logs);
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for process output: ${pattern}`)); }, timeoutMs);
      const cleanup = () => { clearTimeout(timeout); this.events.off('output', output); };
      this.events.on('output', output);
    });
  }
}

export class ProcessSupervisor {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly maxLogBytes: number;

  constructor(options: { maxLogBytes?: number } = {}) { this.maxLogBytes = options.maxLogBytes ?? 256 * 1024; }

  async start(options: { key: string; executable: string; args: string[]; env?: NodeJS.ProcessEnv; cwd?: string }): Promise<ManagedSession> {
    const existing = this.sessions.get(options.key);
    if (existing && ['starting', 'running', 'stopping'].includes(existing.state)) throw new Error(`A connector is already running for ${options.key}.`);
    const child = spawn(options.executable, options.args, { cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const session = new ManagedSession(options.key, child, this.maxLogBytes);
    this.sessions.set(options.key, session);
    child.stdout?.on('data', chunk => session.append(chunk.toString('utf8')));
    child.stderr?.on('data', chunk => session.append(chunk.toString('utf8')));
    child.on('close', code => { session.state = code === 0 || session.state === 'stopping' ? 'stopped' : 'failed'; });
    return new Promise((resolve, reject) => {
      child.once('spawn', () => { session.state = 'running'; resolve(session); });
      child.once('error', error => { session.state = 'failed'; session.append(error.message); reject(error); });
    });
  }

  status(key: string): { state: ManagedProcessState; pid?: number; logs: string } {
    const session = this.sessions.get(key);
    return session ? { state: session.state, pid: session.pid, logs: session.logs() } : { state: 'stopped', logs: '' };
  }

  async stop(key: string, graceMs = 2_000): Promise<{ stopped: boolean; forceRequired: boolean }> {
    const session = this.sessions.get(key);
    if (!session || ['stopped', 'failed'].includes(session.state)) return { stopped: true, forceRequired: false };
    session.state = 'stopping';
    session.child.kill('SIGTERM');
    const stopped = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), graceMs);
      session.child.once('close', () => { clearTimeout(timer); resolve(true); });
    });
    if (stopped) session.state = 'stopped';
    return { stopped, forceRequired: !stopped };
  }
}
