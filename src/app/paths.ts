import path from 'node:path';

export interface AppPaths {
  dataDir: string;
  database: string;
  projectsDir: string;
  backupsDir: string;
  accountsDir: string;
  logsDir: string;
  runtimeDir: string;
  daemonFile: string;
}

export function appPathsFor(dataDir: string, platform: string = process.platform): AppPaths {
  const paths = platform === 'win32' ? path.win32 : path;
  return {
    dataDir,
    database: paths.join(dataDir, 'state.db'),
    projectsDir: paths.join(dataDir, 'projects'),
    backupsDir: paths.join(dataDir, 'backups'),
    accountsDir: paths.join(dataDir, 'accounts'),
    logsDir: paths.join(dataDir, 'logs'),
    runtimeDir: paths.join(dataDir, 'desktop-runtime'),
    daemonFile: paths.join(dataDir, 'daemon.json'),
  };
}

/** The data directory used by the CLI, daemon, and tray: CLOUDFLARE_TUNNEL_KIT_DATA_DIR wins over the platform default. */
export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
  return env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR || resolveAppPaths({ env }).dataDir;
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

  return appPathsFor(paths.join(root, 'cloudflare-tunnel-kit'), platform);
}
