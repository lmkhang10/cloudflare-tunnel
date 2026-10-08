import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createTunnelKitService, type TunnelKitService } from '../app/service.js';
import { appPathsFor } from '../app/paths.js';
import { createServer } from '../ui/server.js';
import { findDaemon, removeDaemonInfo, writeDaemonInfo } from './lock.js';
import { createFileLogger, type Logger } from './logger.js';
import { ConnectorWatchdog } from './watchdog.js';
import { launchTray, runtimeStatus } from '../desktop/runtime.js';
import { appBundleBinary } from '../desktop/bundle.js';

export interface DaemonOptions { dataDir: string; version: string; nodePath: string; cliPath: string; port?: number; tray?: boolean; echo?: boolean; }

const RESUME_TTL_MS = 10 * 60_000;
const UPDATE_FIRST_CHECK_MS = 30_000;

/**
 * Runs the background service: owns every cloudflared connector, serves the UI/API on loopback,
 * restores auto-start projects, restarts crashed connectors, and checks for updates.
 * Resolves with the exit code once shut down.
 */
export async function runDaemon(options: DaemonOptions): Promise<number> {
  const paths = appPathsFor(options.dataDir);
  const log = createFileLogger(paths.logsDir, { echo: options.echo });
  const existing = await findDaemon(options.dataDir);
  if (existing) { log('info', `Another background service is already running (pid ${existing.pid}).`); return 0; }

  // launchd starts agents in "/"; the UI suggests the working directory as a project folder.
  try { process.chdir(os.homedir()); } catch {}
  const env = process.env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR ? { CLOUDFLARE_TUNNEL_KIT_DATA_DIR: process.env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR } : undefined;
  const service = createTunnelKitService({ dataDir: options.dataDir, version: options.version, runtime: { nodePath: options.nodePath, cliPath: options.cliPath, env } });
  const settings = service.getSettings();
  const token = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let shuttingDown: Promise<number> | undefined;
  let watchdog: ConnectorWatchdog | undefined;
  let updateTimer: NodeJS.Timeout | undefined;
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>(resolve => { resolveExit = resolve; });

  const closed = service.reconcileSessions();
  if (closed) log('info', `Closed ${closed} connector session(s) left over from a previous run.`);
  service.accounts?.assignLegacyTunnels();

  const shutdown = (code = 0, reason = 'shutdown requested'): Promise<number> => {
    shuttingDown ??= (async () => {
      log('info', `Stopping background service: ${reason}.`);
      watchdog?.dispose(); clearTimeout(updateTimer);
      await service.stopAll().catch(error => log('error', `Stopping connectors failed: ${error.message}`));
      await new Promise<void>(resolve => server.close(() => resolve()));
      removeDaemonInfo(options.dataDir); service.close();
      resolveExit(code); return code;
    })();
    return shuttingDown;
  };

  const server = createServer({
    service, version: options.version, sessionToken: token,
    daemon: {
      pid: process.pid, startedAt,
      // resume: the next service start brings back the tunnels running now (used by `daemon restart`).
      shutdown: async ({ resume = false } = {}) => {
        if (resume) writeFileSync(path.join(options.dataDir, 'resume.json'), JSON.stringify({ projectIds: service.runningProjectIds(), savedAt: new Date().toISOString() }), { mode: 0o600 });
        setTimeout(() => void shutdown(0), 50); return { stopping: true, resume };
      },
      installUpdate: () => installUpdate(service, options, log, shutdown),
    },
  });
  const port = await listen(server, options.port ?? settings.uiPort, log);
  const url = `http://127.0.0.1:${port}`;
  writeDaemonInfo(options.dataDir, { pid: process.pid, port, token, version: options.version, startedAt, url });
  log('info', `Cloudflare Tunnel Kit v${options.version} background service ready at ${url} (pid ${process.pid}).`);

  watchdog = new ConnectorWatchdog({
    onExit: listener => (service as any).supervisor.onExit(listener),
    projectIdForKey: key => (service as any).store.findProjectIdBySessionKey(key),
    projectName: id => { try { return (service as any).store.getProject(id).displayName; } catch { return 'Project'; } },
    start: id => service.start(id),
    settings: () => service.getSettings(),
    feed: service.feed, log,
  });

  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => void shutdown(0, signal));

  await restoreProjects(service, paths.dataDir, log);
  if (options.tray !== false && service.getSettings().trayEnabled) startTray(options, paths.runtimeDir, log);

  const scheduleUpdateCheck = (delay: number) => {
    updateTimer = setTimeout(async () => {
      const current = service.getSettings();
      if (current.checkForUpdates) {
        try {
          const state = await service.checkForUpdates();
          if (state.available && current.autoInstallUpdates && state.installKind === 'global' && !service.busy) await installUpdate(service, options, log, shutdown);
        } catch (error) { log('warn', `Update check failed: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (!shuttingDown) scheduleUpdateCheck(current.updateCheckIntervalHours * 3_600_000);
    }, delay);
    updateTimer.unref();
  };
  scheduleUpdateCheck(UPDATE_FIRST_CHECK_MS);

  return exited;
}

function listen(server: ReturnType<typeof createServer>, port: number, log: Logger): Promise<number> {
  const attempt = (value: number) => new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(value, '127.0.0.1', () => { server.off('error', reject); resolve((server.address() as { port: number }).port); });
  });
  return attempt(port).catch(error => {
    if (!port) throw error;
    log('warn', `Port ${port} is unavailable (${error.code ?? error.message}); using a free port instead.`);
    return attempt(0);
  });
}

async function restoreProjects(service: TunnelKitService, dataDir: string, log: Logger): Promise<void> {
  const ids = new Set<string>();
  const resumeFile = path.join(dataDir, 'resume.json');
  try {
    const saved = JSON.parse(readFileSync(resumeFile, 'utf8')) as { projectIds: string[]; savedAt: string };
    if (Date.now() - Date.parse(saved.savedAt) < RESUME_TTL_MS) saved.projectIds.forEach(id => ids.add(id));
  } catch {}
  rmSync(resumeFile, { force: true });
  if (service.getSettings().restoreTunnelsOnLaunch) for (const project of (service as any).store.listProjects()) if (project.autoStart) ids.add(project.id);
  // Projects start in parallel; each named setup spends several seconds on Cloudflare round-trips.
  await Promise.all([...ids].map(async id => {
    // Project ids look like tokens to the log redactor, so log the display name instead.
    let name = 'a project'; try { name = (service as any).store.getProject(id).displayName; } catch {}
    try {
      const result = await service.start(id);
      if (result?.state === 'failed') log('warn', `Could not restore ${name}: ${result.error?.reason ?? result.error?.summary ?? 'unknown error'}`);
      else log('info', `Restored ${name}.`);
    } catch (error) { log('warn', `Could not restore ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }));
}

function startTray(options: DaemonOptions, runtimeDir: string, log: Logger): void {
  const runtime = runtimeStatus(runtimeDir);
  if (!runtime.installed || !runtime.binary) return;
  if (!runtime.current) log('warn', `Desktop runtime ${runtime.version} differs from ${runtime.expected}; run \`cftunnel tray\` to update it.`);
  try { launchTray({ binary: runtime.binary, appBinary: process.platform === 'darwin' ? appBundleBinary() : undefined, dataDir: options.dataDir, nodePath: options.nodePath, cliPath: options.cliPath }); }
  catch (error) { log('warn', `Could not start the menu bar app: ${error instanceof Error ? error.message : String(error)}`); }
}

/**
 * Installs the new version, then hands running projects to a fresh daemon. Any failure before the
 * hand-off leaves the current daemon and its connectors untouched.
 */
async function installUpdate(service: TunnelKitService, options: DaemonOptions, log: Logger, shutdown: (code?: number, reason?: string) => Promise<number>): Promise<any> {
  if (!service.updates) throw new Error('Updates are not available.');
  if (service.busy) throw new Error('A tunnel setup is still running. Try again when it finishes.');
  try {
    const { version } = await service.updates.install();
    log('info', `Installed cftunnel ${version}; restarting the background service.`);
    service.feed.push({ type: 'update-installed', title: `cftunnel ${version} installed`, message: 'Restarting the background service. Running tunnels will reconnect in a few seconds.', notify: true });
    writeFileSync(path.join(options.dataDir, 'resume.json'), JSON.stringify({ projectIds: service.runningProjectIds(), savedAt: new Date().toISOString() }), { mode: 0o600 });
    setTimeout(async () => {
      const underLaunchd = process.env.CFTUNNEL_LAUNCHD === '1';
      await shutdown(underLaunchd ? 75 : 0, `update to ${version}`);
      // launchd restarts the agent after a non-zero exit; otherwise start the replacement ourselves.
      if (!underLaunchd) spawn(options.nodePath, [options.cliPath, 'daemon', 'run'], { detached: true, stdio: 'ignore', env: process.env }).unref();
    }, 500);
    return { installed: version, restarting: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Update failed: ${message}`);
    service.feed.push({ type: 'update-failed', title: 'Update failed', message, notify: true });
    throw error;
  }
}
