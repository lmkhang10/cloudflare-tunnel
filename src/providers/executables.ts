import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

/** Resolves an executable name against PATH without spawning a shell. */
export function findExecutable(name: string, options: { pathEnv?: string; platform?: string } = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (name.includes('/') || name.includes('\\')) return isExecutable(name) ? name : undefined;
  const extensions = platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (options.pathEnv ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutable(file: string): boolean {
  try { return statSync(file).isFile() && (accessSync(file, constants.X_OK), true); } catch { return false; }
}

/** Folders where cloudflared and node are usually installed but which GUI-launched processes do not get on PATH. */
export function commonBinDirs(home = process.env.HOME ?? ''): string[] {
  return ['/opt/homebrew/bin', '/usr/local/bin', home && path.join(home, '.local', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean);
}

/** PATH with the common install folders appended, keeping the caller's order first. */
export function withCommonBinDirs(pathEnv = process.env.PATH ?? ''): string {
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of commonBinDirs()) if (!parts.includes(dir)) parts.push(dir);
  return parts.join(path.delimiter);
}
