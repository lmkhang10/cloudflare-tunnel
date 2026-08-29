import { spawn } from 'node:child_process';
import { redact } from '../core/redact.js';
export interface ProcessResult { code: number; stdout: string; stderr: string; }
export function runCloudflared(args: string[], timeoutMs = 120_000): Promise<ProcessResult> {
  return new Promise(resolve => { const child = spawn('cloudflared', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs); child.stdout.on('data', (d: any) => stdout += d); child.stderr.on('data', (d: any) => stderr += d); child.on('error', (e: any) => { clearTimeout(timer); resolve({ code: 127, stdout: '', stderr: redact(e.message) }); }); child.on('close', (code: any) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout: redact(stdout), stderr: redact(stderr) }); }); });
}
