import path from 'node:path';

export interface AppPaths {
  dataDir: string;
  database: string;
  projectsDir: string;
  backupsDir: string;
}

export function resolveAppPaths(input: {
  platform?: string;
  home?: string;
  env?: Record<string, string | undefined>;
} = {}): AppPaths {
  const platform = input.platform ?? process.platform;
  const env = input.env ?? process.env;
  const home = input.home ?? env.HOME ?? env.USERPROFILE ?? '';
  if (!home && platform !== 'win32') throw new Error('Unable to determine the user home directory.');

  const paths = platform === 'win32' ? path.win32 : path;
  const root = platform === 'darwin'
    ? paths.join(home, 'Library', 'Application Support')
    : platform === 'win32'
      ? (env.LOCALAPPDATA ?? paths.join(home, 'AppData', 'Local'))
      : (env.XDG_DATA_HOME ?? paths.join(home, '.local', 'share'));
  if (!root) throw new Error('Unable to determine the local application-data directory.');

  const dataDir = paths.join(root, 'cloudflare-tunnel-kit');
  return {
    dataDir,
    database: paths.join(dataDir, 'state.db'),
    projectsDir: paths.join(dataDir, 'projects'),
    backupsDir: paths.join(dataDir, 'backups'),
  };
}
