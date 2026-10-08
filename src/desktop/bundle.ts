import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../providers/command-runner.js';
import { desktopMainPath, ELECTRON_VERSION } from './runtime.js';

export const APP_NAME = 'Cloudflare Tunnel Kit';
export const APP_BUNDLE_ID = 'vn.cftunnel.app';

type Runner = (executable: string, args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
export interface BundleConfig { version: string; electron: string; main: string; nodePath: string; cliPath: string; dataDir: string; }

export function logoPath(): string { return fileURLToPath(new URL('../../assets/logo.png', import.meta.url)); }
export function appBundlePath(home = os.homedir()): string { return path.join(home, 'Applications', `${APP_NAME}.app`); }
export function appBundleBinary(bundle = appBundlePath()): string { return path.join(bundle, 'Contents', 'MacOS', 'Electron'); }

/** The bundle records where node, the CLI, and the data folder live, because Dock launches get no environment. */
export function readBundleConfig(bundle = appBundlePath()): BundleConfig | undefined {
  try { return JSON.parse(readFileSync(path.join(bundle, 'Contents', 'Resources', 'app', 'config.json'), 'utf8')); } catch { return undefined; }
}

export function bundleIsCurrent(config: Omit<BundleConfig, 'main' | 'electron'>, bundle = appBundlePath()): boolean {
  const saved = readBundleConfig(bundle);
  return Boolean(saved && existsSync(appBundleBinary(bundle)) && saved.electron === ELECTRON_VERSION && saved.main === desktopMainPath()
    && saved.version === config.version && saved.nodePath === config.nodePath && saved.cliPath === config.cliPath && saved.dataDir === config.dataDir);
}

/**
 * Builds ~/Applications/Cloudflare Tunnel Kit.app from the downloaded Electron runtime, so the app has its own name,
 * icon, and Dock identity ("Keep in Dock" then launches this app, not a bare Electron).
 * The Electron copy is an APFS clone when possible, so it takes almost no extra disk space.
 */
export async function installAppBundle(options: { electronBinary: string; config: Omit<BundleConfig, 'main' | 'electron'>; target?: string; run?: Runner }): Promise<string> {
  const run: Runner = options.run ?? ((executable, args) => runCommand({ executable, args, timeoutMs: 120_000 }));
  const target = options.target ?? appBundlePath();
  const source = options.electronBinary.slice(0, options.electronBinary.indexOf('.app/') + 4);
  if (!source.endsWith('.app')) throw new Error('The desktop runtime is not a macOS app bundle.');
  mkdirSync(path.dirname(target), { recursive: true });
  rmSync(target, { recursive: true, force: true });
  if ((await run('cp', ['-cR', source, target])).exitCode !== 0) {
    const copied = await run('cp', ['-R', source, target]);
    if (copied.exitCode !== 0) throw new Error(`Could not create ${target}: ${copied.stderr.trim()}`);
  }

  const contents = path.join(target, 'Contents'); const plist = path.join(contents, 'Info.plist');
  for (const [key, value] of [['CFBundleName', APP_NAME], ['CFBundleDisplayName', APP_NAME], ['CFBundleIdentifier', APP_BUNDLE_ID], ['CFBundleIconFile', 'AppIcon.icns']]) {
    const result = await run('plutil', ['-replace', key, '-string', value, plist]);
    if (result.exitCode !== 0) throw new Error(`Could not update the app's Info.plist (${key}): ${result.stderr.trim()}`);
  }
  await writeIcns(path.join(contents, 'Resources', 'AppIcon.icns'), run);

  // Electron loads Resources/app before its default app; this tiny app sets the environment and loads the real main.
  const appDir = path.join(contents, 'Resources', 'app');
  mkdirSync(appDir, { recursive: true });
  const config: BundleConfig = { ...options.config, electron: ELECTRON_VERSION, main: desktopMainPath() };
  writeFileSync(path.join(appDir, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'cloudflare-tunnel-kit-desktop', productName: APP_NAME, version: options.config.version, type: 'module', main: 'main.js' }, null, 2));
  writeFileSync(path.join(appDir, 'main.js'), [
    "import { readFileSync } from 'node:fs';",
    "import { pathToFileURL } from 'node:url';",
    "const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));",
    'process.env.CFTUNNEL_NODE ??= config.nodePath;',
    'process.env.CFTUNNEL_CLI ??= config.cliPath;',
    'process.env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR ??= config.dataDir;',
    'await import(pathToFileURL(config.main).href);',
    '',
  ].join('\n'));

  // Editing Info.plist invalidates Electron's signature; an ad-hoc signature lets macOS launch the local copy.
  const signed = await run('codesign', ['--force', '--deep', '--sign', '-', target]);
  if (signed.exitCode !== 0) throw new Error(`Could not sign ${target}: ${signed.stderr.trim()}`);
  await run('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', target]);
  return target;
}

async function writeIcns(destination: string, run: Runner): Promise<void> {
  const work = mkdtempSync(path.join(os.tmpdir(), 'cftunnel-icon-'));
  try {
    const iconset = path.join(work, 'AppIcon.iconset'); mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = size * scale; const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        const resized = await run('sips', ['-z', String(pixels), String(pixels), logoPath(), '--out', path.join(iconset, name)]);
        if (resized.exitCode !== 0) throw new Error(`Could not render the app icon: ${resized.stderr.trim()}`);
      }
    }
    const built = await run('iconutil', ['-c', 'icns', iconset, '-o', destination]);
    if (built.exitCode !== 0) throw new Error(`Could not build the app icon: ${built.stderr.trim()}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}
