#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createServer } from '../ui/server.js';
import { launchBrowser } from '../providers/browser.js';
import { createTunnelKitService } from '../app/service.js';
import { appPathsFor, resolveDataDir } from '../app/paths.js';
import { chooseLauncher, runWizard } from './wizard.js';
import { connectDaemon, remoteService, spawnDaemon, type DaemonClient } from '../daemon/client.js';
import { pidAlive } from '../daemon/lock.js';
import { installRuntime, launchTray, runtimeStatus, ELECTRON_VERSION } from '../desktop/runtime.js';
import { appBundleBinary, appBundlePath, bundleIsCurrent, installAppBundle } from '../desktop/bundle.js';
import { createAutostartBackend } from '../providers/autostart/index.js';

const args = process.argv.slice(2); const command = args[0] ?? 'launch';
const packageVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const cliPath = fileURLToPath(import.meta.url); const nodePath = process.execPath;
const dataDir = resolveDataDir(); const paths = appPathsFor(dataDir);
const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const flag = (name: string) => args.includes(name);
const print = (result: unknown) => console.log(JSON.stringify(result, null, 2));

function help() { console.log(`cloudflare-tunnel-kit ${packageVersion}

Usage from an installed project:
  npx cf-tunnel
  npx cf-tunnel ui [--port PORT]

Everyday:
  cftunnel                    Choose: menu bar app, browser dashboard, or terminal wizard
  cftunnel init               Terminal wizard
  cftunnel ui                 Open the dashboard (menu bar window if installed, else browser)
  cftunnel tray               Install/start the menu bar app (downloads Electron ${ELECTRON_VERSION} once)
                              On macOS this also creates ~/Applications/Cloudflare Tunnel Kit.app for the Dock
                              (--reinstall-app rebuilds it)
  cftunnel daemon start|stop|restart|status
                              Background service that keeps tunnels running after the terminal closes
  cftunnel autostart enable|disable|status
                              Launch the background service at login (macOS)
  cftunnel account list|discover|import <file|--all>|login|verify|rename|remove|default
                              Manage Cloudflare accounts (one certificate per account)
  cftunnel settings [get [KEY] | set KEY VALUE]
  cftunnel update [--check]   Check for or install a new cftunnel version

Commands: init create quick start stop restart status doctor ui tray daemon autostart account settings update
Options: --replace-dns (with retry: replace an existing DNS record) --url URL --name NAME --hostname HOST --path DIR --project-name NAME --profile custom|laravel --account ID --project ID --port PORT --dry-run --yes --json --no-open --browser --foreground
UI port precedence: --port, CLOUDFLARE_TUNNEL_KIT_UI_PORT, the uiPort setting, automatic
The UI always binds to 127.0.0.1.

Built by Field Tech Vietnam, web and system development to Japanese standards: https://field.vn`); }
function interactiveRequired(): never { console.error('[INTERACTIVE_INPUT_REQUIRED] This command needs wizard input, but the terminal is not interactive.\nRun `npx cf-tunnel ui` or provide all required flags with `--yes`.'); process.exit(2); }
function resolveUiPort(): number | undefined { const raw = value('--port') ?? process.env.CLOUDFLARE_TUNNEL_KIT_UI_PORT; if (raw === undefined || raw === '') return undefined; const port = Number(raw); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid UI port "${raw}". Use an integer from 0 to 65535.`); return port; }
async function confirm(question: string): Promise<boolean> {
  if (flag('--yes')) return true;
  if (!stdin.isTTY) interactiveRequired();
  const rl = createInterface({ input: stdin, output: stdout });
  try { return ['y', 'yes'].includes((await rl.question(`${question} [y/N]: `)).trim().toLowerCase()); } finally { rl.close(); }
}
const localService = () => createTunnelKitService({ dataDir, version: packageVersion, runtime: { nodePath, cliPath, env: process.env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR ? { CLOUDFLARE_TUNNEL_KIT_DATA_DIR: dataDir } : undefined } });

/** Connects to the background service, starting it (through launchd when registered) if needed. */
/** `tray: false` when this command opens the tray itself, so the service does not open a second one. */
async function ensureDaemon(options: { tray?: boolean } = {}): Promise<DaemonClient> {
  const running = await connectDaemon(dataDir); if (running) return running;
  console.log('Starting the Cloudflare Tunnel Kit background service...');
  const port = resolveUiPort();
  const autostart = createAutostartBackend();
  if (port === undefined && (await autostart.status()).enabled && await autostart.kickstart()) {
    for (let attempt = 0; attempt < 75; attempt++) { const client = await connectDaemon(dataDir); if (client) return client; await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  return spawnDaemon({ nodePath, cliPath, dataDir, args: [...(port === undefined ? [] : ['--port', String(port)]), ...(options.tray === false ? ['--no-tray'] : [])] });
}

async function startForegroundUi() {
  const port = resolveUiPort() ?? 0;
  console.log('Starting Cloudflare Tunnel Kit UI on this machine (foreground)...');
  const service = localService(); const server = createServer({ service, version: packageVersion });
  server.once('error', error => { console.error(`Unable to start the local UI: ${error.message}`); console.error('Run `npx cf-tunnel ui` again after checking local server permissions.'); process.exitCode = 1; service.close(); });
  console.log(`Cloudflare Tunnel Kit v${packageVersion}`);
  server.listen(port, '127.0.0.1', async () => { const address = server.address(); if (!address || typeof address === 'string') return; const url = `http://127.0.0.1:${address.port}`; console.log(`UI ready at ${url}`); console.log('Tunnels stop when this command exits. Run `cftunnel ui` without --foreground to keep them running in the background.'); if (!flag('--no-open')) console.log((await launchBrowser(url)).message); });
  process.once('SIGINT', () => { server.close(async () => { await service.stopAll(); service.close(); process.exit(130); }); server.closeAllConnections(); });
}

async function openUi(options: { browser?: boolean } = {}) {
  if (flag('--foreground')) return startForegroundUi();
  const browser = options.browser ?? flag('--browser');
  const runtime = runtimeStatus(paths.runtimeDir);
  const client = await ensureDaemon({ tray: browser || flag('--no-open') || !runtime.installed });
  console.log(`Cloudflare Tunnel Kit v${client.info.version} running in the background at ${client.info.url}`);
  if (!browser && !flag('--no-open') && runtime.installed && runtime.binary) {
    launchTray({ binary: runtime.binary, appBinary: macApp(), dataDir, nodePath, cliPath, openWindow: true });
    console.log('Opened the Cloudflare Tunnel Kit window. Use the menu bar icon to reopen it.');
    return;
  }
  if (!runtime.installed) console.log('Tip: run `cftunnel tray` once to get a menu bar icon and a native settings window.');
  if (!flag('--no-open')) console.log((await launchBrowser(client.info.url)).message);
}

const macApp = () => process.platform === 'darwin' ? appBundleBinary() : undefined;

/** Keeps ~/Applications/Cloudflare Tunnel Kit.app in sync with this CLI so it can be kept in the Dock. */
async function ensureMacApp(binary: string, force = false): Promise<void> {
  if (process.platform !== 'darwin') return;
  const config = { version: packageVersion, nodePath, cliPath, dataDir };
  if (!force && bundleIsCurrent(config)) return;
  try {
    const target = await installAppBundle({ electronBinary: binary, config });
    console.log(`Installed ${target}. Open it from Launchpad or Spotlight; while it runs, right-click its Dock icon → Options → Keep in Dock.`);
  } catch (error) { console.log(`Could not create the macOS app (${error instanceof Error ? error.message : String(error)}). The menu bar app still works.`); }
}

async function tray() {
  let runtime = runtimeStatus(paths.runtimeDir);
  if (!runtime.current) {
    const reason = runtime.installed ? `The desktop runtime is ${runtime.version}; this version of cftunnel uses Electron ${ELECTRON_VERSION}.` : `The menu bar app needs the Electron ${ELECTRON_VERSION} runtime (about 100 MB, stored in ${paths.runtimeDir}).`;
    console.log(reason);
    if (!await confirm('Download and install it now?')) { console.log('Cancelled. `cftunnel ui --browser` opens the dashboard in your browser instead.'); return; }
    runtime = await installRuntime({ runtimeDir: paths.runtimeDir, nodePath });
  }
  await ensureMacApp(runtime.binary!, flag('--reinstall-app'));
  await ensureDaemon({ tray: false });
  const delay = Number(value('--delay') ?? 0); if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 30_000)));
  launchTray({ binary: runtime.binary!, appBinary: macApp(), dataDir, nodePath, cliPath, openWindow: !flag('--background') });
  console.log('Cloudflare Tunnel Kit is in the menu bar. Closing the window keeps tunnels running.');
}

async function daemon(sub = 'status') {
  if (sub === 'run') {
    const { runDaemon } = await import('../daemon/daemon.js');
    process.exit(await runDaemon({ dataDir, version: packageVersion, nodePath, cliPath, port: resolveUiPort(), tray: !flag('--no-tray'), echo: Boolean(stdout.isTTY) }));
  }
  if (sub === 'start') { const client = await ensureDaemon(); return print({ running: true, pid: client.info.pid, url: client.info.url, version: client.info.version }); }
  if (sub === 'stop' || sub === 'restart') {
    const client = await connectDaemon(dataDir);
    if (client) {
      await client.post('/api/daemon/shutdown', { resume: sub === 'restart' });
      for (let attempt = 0; attempt < 100 && pidAlive(client.info.pid); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      console.log(sub === 'restart' ? 'Background service stopped; running tunnels will be started again.' : 'Background service stopped. Running tunnels were stopped.');
    } else console.log('The background service is not running.');
    if (sub === 'restart') return daemon('start');
    return;
  }
  if (sub === 'status') {
    const client = await connectDaemon(dataDir); const autostart = await createAutostartBackend().status();
    return print(client ? { running: true, pid: client.info.pid, url: client.info.url, version: client.info.version, startedAt: client.info.startedAt, launchAtLogin: autostart.enabled, logs: paths.logsDir } : { running: false, launchAtLogin: autostart.enabled, logs: paths.logsDir });
  }
  throw new Error(`Unknown daemon command "${sub}". Use run, start, stop, restart, or status.`);
}

async function autostart(sub = 'status') {
  const service = localService();
  try {
    if (sub === 'status') return print(await service.autostartStatus());
    if (sub !== 'enable' && sub !== 'disable') throw new Error(`Unknown autostart command "${sub}". Use enable, disable, or status.`);
    const status = await service.setAutostart(sub === 'enable');
    print(status);
    if (sub === 'enable') console.log('The background service now starts at login. If it was already running, it keeps running until you stop it.');
  } finally { service.close(); }
}

async function account(sub = 'list') {
  const service = localService();
  try {
    const id = args[2];
    if (sub === 'list') return print(service.listAccounts());
    if (sub === 'discover') return print(service.discoverAccounts());
    if (sub === 'import') {
      if (flag('--all')) { const imported = service.accounts!.importAll(); if (!service.getSettings().defaultAccountId && imported[0]) service.setDefaultAccount(imported[0].id); return print({ imported }); }
      if (!id) throw new Error('Name a certificate from `cftunnel account discover` (for example cert.pem.work) or pass --all.');
      return print(service.importAccount({ candidateId: id, label: value('--label') }));
    }
    if (sub === 'login') {
      const job = service.startAccountLogin({ label: value('--label'), accountId: value('--account') });
      console.log('Opening Cloudflare sign-in in your browser. This sign-in does not touch ~/.cloudflared/cert.pem.');
      let shown = false;
      for (;;) {
        const current = service.getAccountLogin(job.id);
        if (!shown && current.loginUrl) { console.log(`If the browser did not open, visit:\n${current.loginUrl}`); shown = true; }
        if (current.state !== 'running') { if (current.state === 'failed') { process.exitCode = 1; return print({ error: current.error }); } return print(service.listAccounts().accounts.find((item: any) => item.id === current.accountId)); }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    if (!id) throw new Error(`Pass an account id: cftunnel account ${sub} <id>. List ids with \`cftunnel account list\`.`);
    if (sub === 'verify') return print(await service.verifyAccount(id));
    if (sub === 'rename') return print(service.renameAccount(id, args[3]));
    if (sub === 'remove') { service.removeAccount(id); return console.log('Account removed.'); }
    if (sub === 'default') return print(service.setDefaultAccount(id));
    throw new Error(`Unknown account command "${sub}".`);
  } finally { service.close(); }
}

async function settings(sub = 'get') {
  const service = localService();
  try {
    if (sub === 'get') { const values = service.getSettings() as Record<string, unknown>; return args[2] ? print(values[args[2]]) : print(values); }
    if (sub === 'set') { if (!args[2] || args[3] === undefined) throw new Error('Usage: cftunnel settings set KEY VALUE'); return print(service.updateSettings({ [args[2]]: args[3] }).values); }
    throw new Error(`Unknown settings command "${sub}". Use get or set.`);
  } finally { service.close(); }
}

async function update() {
  const service = localService();
  try {
    const state = await service.checkForUpdates();
    print({ current: state.current, latest: state.latest, available: state.available, installKind: state.installKind, cloudflared: state.cloudflared, error: state.error });
    if (flag('--check') || !state.available) return;
    if (state.installKind !== 'global') return console.log(`Update this copy with: ${state.installCommand}`);
    if (!await confirm(`Install cftunnel ${state.latest} now?`)) return;
    const client = await connectDaemon(dataDir);
    if (client) { print(await client.post('/api/updates/install')); console.log('The background service restarts on the new version and resumes running tunnels.'); }
    else { print(await service.updates!.install()); }
  } finally { service.close(); }
}

/** `cftunnel` with no arguments: pick the native app, the browser dashboard, or the terminal wizard. */
async function launch() {
  if (!stdin.isTTY) interactiveRequired();
  const running = await connectDaemon(dataDir);
  const status = running ? `Background service: running at ${running.info.url}` : 'Background service: not running (it starts automatically)';
  const choice = await chooseLauncher(status);
  if (choice === 'app') return tray();
  if (choice === 'browser') return openUi({ browser: true });
  if (choice === 'terminal') return runWizard(running ? remoteService(running) : remoteService(await ensureDaemon()));
  console.log('Invalid choice. Run `cftunnel` again and choose 1, 2, or 3.'); process.exitCode = 2;
}

async function main() {
  if (['help', '--help', '-h'].includes(command)) return help();
  if (command === 'launch') return launch();
  if (['version', '--version', '-v'].includes(command)) return console.log(packageVersion);
  if (command === 'ui') return openUi();
  if (command === 'tray') return tray();
  if (command === 'daemon') return daemon(args[1]);
  if (command === 'autostart') return autostart(args[1]);
  if (command === 'account' || command === 'accounts') return account(args[1]);
  if (command === 'settings') return settings(args[1]);
  if (command === 'update') return update();
  if (command === 'init' && !stdin.isTTY) interactiveRequired();
  if (command === 'doctor') { const service = localService(); print(await service.doctor()); service.close(); return; }
  // Connectors run inside the background service so they outlive this command.
  const background = async () => remoteService(await ensureDaemon());
  if (command === 'init') return runWizard(flag('--foreground') ? localService() : await background());
  if (command === 'quick' || command === 'create') {
    const mode = command === 'quick' ? 'quick' : 'named';
    const localUrl = value('--url'); const tunnelName = value('--name'); const hostname = value('--hostname');
    if (!localUrl || (mode === 'named' && (!tunnelName || !hostname))) { if (!stdin.isTTY) interactiveRequired(); return runWizard(await background(), mode); }
    const input = { projectPath: value('--path') ?? process.cwd(), displayName: value('--project-name'), profile: value('--profile') === 'laravel' ? 'laravel' : 'custom', localUrl, tunnelName, hostname, accountId: value('--account') };
    if (flag('--dry-run')) { const service = localService(); const plan = mode === 'quick' ? await service.prepareQuick(input) : await service.prepareNamed(input); print(plan); service.close(); return; }
    if (!flag('--yes')) { if (!stdin.isTTY) interactiveRequired(); return runWizard(await background(), mode); }
    const service = flag('--foreground') ? localService() : await background();
    const plan = mode === 'quick' ? await service.prepareQuick(input) : await service.prepareNamed(input);
    return print(await service.execute(plan.id, plan.confirmations));
  }
  if (['start', 'stop', 'restart', 'status', 'retry'].includes(command)) {
    const projectId = value('--project');
    const running = await connectDaemon(dataDir);
    if (!projectId) { if (!stdin.isTTY) interactiveRequired(); return runWizard(running ? remoteService(running) : await background()); }
    const service = running ? remoteService(running) : ['status', 'stop'].includes(command) ? localService() : await background();
    const result = command === 'status' ? await service.getProject(projectId)
      : command === 'start' ? await service.start(projectId)
      : command === 'stop' ? await service.stop(projectId)
      : command === 'restart' ? await service.restart(projectId)
      : flag('--replace-dns') ? await service.replaceDns(projectId)
      : await service.retry(projectId);
    print(result ?? { ok: true }); service.close(); return;
  }
  help(); process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
