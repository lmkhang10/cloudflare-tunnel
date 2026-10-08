import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { redact } from '../core/redact.js';

export type Logger = (level: 'info' | 'warn' | 'error', message: string) => void;

/** Appends redacted lines to logs/daemon.log and keeps one rotated copy once it passes `maxBytes`. */
export function createFileLogger(logsDir: string, options: { maxBytes?: number; echo?: boolean } = {}): Logger {
  const file = path.join(logsDir, 'daemon.log'); const maxBytes = options.maxBytes ?? 1024 * 1024;
  mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  return (level, message) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redact(message)}\n`;
    if (options.echo) process.stdout.write(line);
    try {
      if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > maxBytes) renameSync(file, `${file}.1`);
      appendFileSync(file, line, { mode: 0o600 });
    } catch {}
  };
}
