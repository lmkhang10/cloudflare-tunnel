import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Discovery record for the running background service. Kept free of heavy imports so the tray can load it. */
export interface DaemonInfo { pid: number; port: number; token: string; version: string; startedAt: string; url: string; }

export function daemonFile(dataDir: string): string { return path.join(dataDir, 'daemon.json'); }

export function readDaemonInfo(dataDir: string): DaemonInfo | undefined {
  try {
    const value = JSON.parse(readFileSync(daemonFile(dataDir), 'utf8'));
    return Number.isInteger(value.pid) && Number.isInteger(value.port) && typeof value.token === 'string' ? value : undefined;
  } catch { return undefined; }
}

export function writeDaemonInfo(dataDir: string, info: DaemonInfo): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = daemonFile(dataDir); const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(info, null, 2), { mode: 0o600 }); renameSync(temporary, file);
}

export function removeDaemonInfo(dataDir: string, pid = process.pid): void {
  if (readDaemonInfo(dataDir)?.pid === pid) rmSync(daemonFile(dataDir), { force: true });
}

export function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** A daemon counts as running only when its pid is alive and its health endpoint answers with the same pid. */
export async function findDaemon(dataDir: string, timeoutMs = 1_500): Promise<DaemonInfo | undefined> {
  const info = readDaemonInfo(dataDir);
  if (!info || !pidAlive(info.pid)) return undefined;
  try {
    const response = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const health = await response.json() as { pid?: number; version?: string };
    return response.ok && health.pid === info.pid ? { ...info, version: health.version ?? info.version } : undefined;
  } catch { return undefined; }
}
