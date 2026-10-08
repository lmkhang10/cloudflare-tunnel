import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Electron is downloaded on first `cftunnel tray`, not with the CLI, so the npm package stays small. */
export const ELECTRON_VERSION = '44.4.5';

export interface RuntimeStatus { installed: boolean; current: boolean; version?: string; binary?: string; expected: string; }

export function desktopMainPath(): string { return fileURLToPath(new URL('./main.js', import.meta.url)); }

export function runtimeStatus(runtimeDir: string, platform: string = process.platform): RuntimeStatus {
  const electronDir = path.join(runtimeDir, 'node_modules', 'electron');
  try {
    const version = (JSON.parse(readFileSync(path.join(electronDir, 'package.json'), 'utf8')) as { version: string }).version;
    const relative = readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim();
    const binary = path.join(electronDir, 'dist', relative);
    const installed = existsSync(binary) && (platform !== 'darwin' || binary.includes('.app'));
    return { installed, current: installed && version === ELECTRON_VERSION, version, binary: installed ? binary : undefined, expected: ELECTRON_VERSION };
  } catch { return { installed: false, current: false, expected: ELECTRON_VERSION }; }
}

/** Installs the pinned Electron into the app data folder with the npm that ships next to `nodePath`. */
export function installRuntime(options: { runtimeDir: string; nodePath: string; stdio?: 'inherit' | 'ignore' }): Promise<RuntimeStatus> {
  mkdirSync(options.runtimeDir, { recursive: true, mode: 0o700 });
  const manifest = path.join(options.runtimeDir, 'package.json');
  if (!existsSync(manifest)) writeFileSync(manifest, JSON.stringify({ name: 'cftunnel-desktop-runtime', private: true }, null, 2));
  const npm = path.join(path.dirname(options.nodePath), process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const run = (executable: string, args: string[], cwd: string) => new Promise<number | null>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: options.stdio ?? 'inherit', shell: false });
    child.once('error', reject); child.once('close', resolve);
  });
  return (async () => {
    const code = await run(npm, ['install', `electron@${ELECTRON_VERSION}`, '--save-exact', '--no-audit', '--no-fund'], options.runtimeDir);
    if (code !== 0) throw new Error(`Installing the desktop runtime failed (npm exit ${code}). Retry with \`cftunnel tray\`.`);
    // npm 11 can skip dependency install scripts; Electron's postinstall is what downloads the binary.
    const electronDir = path.join(options.runtimeDir, 'node_modules', 'electron');
    if (!runtimeStatus(options.runtimeDir).current && existsSync(path.join(electronDir, 'install.js'))) await run(options.nodePath, ['install.js'], electronDir);
    const status = runtimeStatus(options.runtimeDir);
    if (!status.current) throw new Error('The Electron download did not complete. Check your network connection and retry with `cftunnel tray`.');
    return status;
  })();
}

/** Starts the tray detached; Electron's single-instance lock turns a second launch into "open the window". */
export function launchTray(options: { binary: string; dataDir: string; nodePath: string; cliPath: string; openWindow?: boolean; appBinary?: string; env?: NodeJS.ProcessEnv }): void {
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), CFTUNNEL_NODE: options.nodePath, CFTUNNEL_CLI: options.cliPath, CLOUDFLARE_TUNNEL_KIT_DATA_DIR: options.dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const flags = options.openWindow ? ['--open-window'] : ['--background'];
  // The installed .app carries its own entry point; a bare runtime needs the main script path.
  const useApp = Boolean(options.appBinary && existsSync(options.appBinary));
  const child = spawn(useApp ? options.appBinary! : options.binary, useApp ? flags : [desktopMainPath(), ...flags], { detached: true, stdio: 'ignore', env });
  child.unref();
}
