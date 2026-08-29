import { spawn } from 'node:child_process';

export interface CommandResult {
  exitCode: number; signal: string | null; stdout: string; stderr: string; timedOut: boolean;
}

export function runCommand(options: {
  executable: string; args: string[]; env?: NodeJS.ProcessEnv; cwd?: string;
  timeoutMs?: number; signal?: AbortSignal; maxOutputBytes?: number;
}): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
  return new Promise(resolve => {
    let settled = false;
    let stdout = '', stderr = '', timedOut = false;
    const child = spawn(options.executable, options.args, { cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = (current: string, chunk: Buffer): string => Buffer.from(current + chunk.toString('utf8')).subarray(-maxOutputBytes).toString('utf8');
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const finish = (exitCode: number, signal: string | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    };
    const abort = () => child.kill('SIGTERM');
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.on('error', error => { stderr = append(stderr, Buffer.from(error.message)); finish(127, null); });
    child.on('close', (code, signal) => finish(code ?? 1, signal));
  });
}
