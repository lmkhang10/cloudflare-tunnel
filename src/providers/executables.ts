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
