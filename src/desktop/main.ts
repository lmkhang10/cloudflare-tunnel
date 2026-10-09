// Electron main process for the menu bar app. It never opens the database: every action goes
// through the background daemon's loopback API, so the native better-sqlite3 build is not needed here.
import { app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, nativeImage, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { findDaemon, type DaemonInfo } from '../daemon/lock.js';
import { cloudIconPng } from './icon.js';
import { logoPath } from './bundle.js';

const dataDir = process.env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR ?? '';
const nodePath = process.env.CFTUNNEL_NODE ?? 'node';
const cliPath = process.env.CFTUNNEL_CLI ?? '';
const REFRESH_MS = 4_000;

interface Snapshot { projects: any[]; settings: any; autostart: any; updates: any; }

let daemon: DaemonInfo | undefined;
let tray: Tray | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;
let lastEventId: number | undefined;
let firstVersion: string | undefined;
let lastMenuKey = '';
let snapshot: Snapshot = { projects: [], settings: {}, autostart: {}, updates: {} };
const icons = { idle: templateIcon(false), running: templateIcon(true) };

function templateIcon(filled: boolean) {
  const image = nativeImage.createFromBuffer(cloudIconPng(32, { filled }), { scaleFactor: 2 });
  image.setTemplateImage(true);
  return image;
}

async function api(method: 'GET' | 'POST', pathname: string, body: unknown = {}): Promise<any> {
  if (!daemon) throw new Error('The background service is not running.');
  const response = await fetch(`${daemon.url}${pathname}`, { method, headers: { 'content-type': 'application/json', 'x-confirmation-token': daemon.token }, body: method === 'POST' ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(method === 'GET' ? 5_000 : 120_000) });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status}).`);
  return value;
}

async function ensureDaemon(): Promise<DaemonInfo | undefined> {
  daemon = await findDaemon(dataDir);
  if (daemon || !cliPath) return daemon;
  spawn(nodePath, [cliPath, 'daemon', 'start'], { detached: true, stdio: 'ignore', env: process.env }).unref();
  for (let attempt = 0; attempt < 75 && !daemon; attempt++) { await new Promise(resolve => setTimeout(resolve, 200)); daemon = await findDaemon(dataDir); }
  return daemon;
}

/** The Dock icon shows while the window is open (so it can be Cmd-Tabbed) or always when the setting is on. */
function syncDock(): void {
  if (process.platform !== 'darwin' || !app.dock) return;
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  if (snapshot.settings.showDockIcon || windowVisible) void app.dock.show(); else app.dock.hide();
}

async function openWindow(tab?: string): Promise<void> {
  if (!daemon && !await ensureDaemon()) { dialog.showErrorBox('Cloudflare Tunnel Kit', 'The background service could not be started. Run `cftunnel daemon start` in a terminal for details.'); return; }
  const url = `${daemon!.url}/?shell=desktop${tab ? `&settings=${encodeURIComponent(tab)}` : ''}`;
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({ icon: logoPath(), width: 1120, height: 780, minWidth: 420, minHeight: 520, title: 'Cloudflare Tunnel Kit', show: false, backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1014' : '#f5f6f8', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    mainWindow.on('close', event => { if (!quitting) { event.preventDefault(); mainWindow?.hide(); } });
    mainWindow.on('show', syncDock); mainWindow.on('hide', syncDock);
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    const external = (target: string) => { try { const parsed = new URL(target); if (['http:', 'https:'].includes(parsed.protocol)) void shell.openExternal(target); } catch {} };
    mainWindow.webContents.setWindowOpenHandler(({ url: target }) => { external(target); return { action: 'deny' }; });
    mainWindow.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== new URL(daemon!.url).origin) { event.preventDefault(); external(target); } });
    await mainWindow.loadURL(url);
  } else if (tab || !mainWindow.webContents.getURL().startsWith(daemon!.url)) await mainWindow.loadURL(url);
  mainWindow.show(); mainWindow.focus();
  if (process.platform === 'darwin') app.focus({ steal: true });
}

async function act(label: string, operation: () => Promise<unknown>): Promise<void> {
  try { await operation(); } catch (error) { notify(label, error instanceof Error ? error.message : String(error)); }
  await refresh();
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: false });
  notification.on('click', () => void openWindow());
  notification.show();
}

function relaunchForNewVersion(): void {
  // The CLI reinstalls the desktop runtime if the new release pins another Electron, then starts a fresh tray.
  if (cliPath) spawn(nodePath, [cliPath, 'tray', '--yes', '--background', '--delay', '1500'], { detached: true, stdio: 'ignore', env: process.env }).unref();
  quitting = true; app.exit(0);
}

async function refresh(): Promise<void> {
  try {
    if (!daemon) daemon = await findDaemon(dataDir);
    if (daemon) {
      const health = await api('GET', '/api/health');
      firstVersion ??= health.version;
      if (health.version !== firstVersion) return relaunchForNewVersion();
      // The service may come back on another port; keep an open window pointed at the live one.
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.getURL().startsWith(daemon.url)) void mainWindow.loadURL(`${daemon.url}/?shell=desktop`);
      const [projects, settings, autostart, updates, events] = await Promise.all([
        api('GET', '/api/projects'), api('GET', '/api/settings'), api('GET', '/api/autostart').catch(() => ({})), api('GET', '/api/updates').catch(() => ({})), api('GET', `/api/events?after=${lastEventId ?? 0}`).catch(() => ({ events: [], lastId: lastEventId ?? 0 })),
      ]);
      snapshot = { projects: projects.projects, settings: settings.values, autostart, updates };
      // Events from before the tray started are history, not news.
      if (lastEventId !== undefined) for (const event of events.events) if (event.notify) notify(event.title, event.message);
      lastEventId = events.lastId;
    }
  } catch { daemon = undefined; }
  syncDock();
  renderMenu();
}

function renderMenu(): void {
  if (!tray) return;
  const running = snapshot.projects.filter(project => project.status === 'Running');
  const updates = snapshot.updates ?? {};
  const key = JSON.stringify({ daemon: Boolean(daemon), projects: snapshot.projects.map(p => [p.id, p.displayName, p.status, p.publicUrl, p.autoStart]), auto: snapshot.autostart, update: [updates.available, updates.latest, updates.installing, updates.installKind] });
  if (key === lastMenuKey) return;
  lastMenuKey = key;
  tray.setImage(running.length ? icons.running : icons.idle);
  tray.setToolTip(daemon ? `Cloudflare Tunnel Kit — ${running.length} of ${snapshot.projects.length} tunnels running` : 'Cloudflare Tunnel Kit — background service stopped');
  const project = (item: any): MenuItemConstructorOptions => {
    const isRunning = item.status === 'Running';
    const target = item.publicUrl as string | undefined;
    return {
      label: `${isRunning ? '●' : item.status === 'Starting' ? '◐' : '○'}  ${item.displayName}`,
      submenu: [
        { label: target ?? item.hostname ?? (item.kind === 'named' ? 'Custom domain' : 'Quick Tunnel'), enabled: false },
        { label: `${item.status}${item.accountLabel ? ` · ${item.accountLabel}` : ''}`, enabled: false },
        { type: 'separator' },
        ...(item.status === 'Starting'
          ? [{ label: 'Starting…', enabled: false }]
          : isRunning
          ? [{ label: 'Stop', click: () => act(`Stop ${item.displayName}`, () => api('POST', `/api/projects/${encodeURIComponent(item.id)}/stop`)) }, { label: 'Restart', click: () => act(`Restart ${item.displayName}`, () => api('POST', `/api/projects/${encodeURIComponent(item.id)}/restart`)) }]
          : [{ label: 'Start', click: () => act(`Start ${item.displayName}`, async () => { const result = await api('POST', `/api/projects/${encodeURIComponent(item.id)}/start`); if (result?.state === 'failed') throw new Error(result.error?.summary ?? result.error?.reason ?? 'The tunnel could not start.'); }) }]) as MenuItemConstructorOptions[],
        { type: 'separator' },
        { label: 'Copy public URL', enabled: Boolean(target), click: () => clipboard.writeText(target ?? '') },
        { label: 'Open public URL', enabled: Boolean(target), click: () => void shell.openExternal(target!) },
        { label: 'Start with the service', type: 'checkbox', checked: Boolean(item.autoStart), click: menuItem => act('Auto-start', () => api('POST', `/api/projects/${encodeURIComponent(item.id)}/settings`, { autoStart: menuItem.checked })) },
      ],
    };
  };
  const template: MenuItemConstructorOptions[] = daemon ? [
    { label: `${running.length} of ${snapshot.projects.length} tunnels running`, enabled: false },
    { type: 'separator' },
    ...(snapshot.projects.length ? snapshot.projects.map(project) : [{ label: 'No saved projects yet', enabled: false }]),
    { type: 'separator' },
    { label: 'Start all', enabled: running.length < snapshot.projects.length, click: () => act('Start all', () => api('POST', '/api/projects/start-all')) },
    { label: 'Stop all', enabled: running.length > 0, click: () => act('Stop all', () => api('POST', '/api/projects/stop-all')) },
    { type: 'separator' },
    { label: 'Open Cloudflare Tunnel Kit…', click: () => void openWindow() },
    { label: 'Settings…', click: () => void openWindow('general') },
    { label: 'Open in browser', click: () => void shell.openExternal(daemon!.url) },
    { type: 'separator' },
    { label: 'Launch at login', type: 'checkbox', checked: Boolean(snapshot.autostart.enabled), enabled: snapshot.autostart.supported !== false, click: menuItem => act('Launch at login', () => api('POST', '/api/autostart', { enabled: menuItem.checked })) },
    updates.available
      ? updates.installKind === 'global'
        ? { label: updates.installing ? `Installing ${updates.latest}…` : `Install update ${updates.latest} and restart`, enabled: !updates.installing, click: () => act('Update', () => api('POST', '/api/updates/install')) }
        : { label: `Update ${updates.latest} available…`, click: () => void openWindow('updates') }
      : { label: 'Check for updates', click: () => act('Update check', async () => { const state = await api('POST', '/api/updates/check'); if (!state.available) notify('Cloudflare Tunnel Kit', `You are on the latest version (${state.current}).`); }) },
    { type: 'separator' },
    { label: 'Built by Field Tech Vietnam · field.vn', click: () => void shell.openExternal('https://field.vn') },
    { type: 'separator' },
    { label: 'Quit menu bar app (tunnels keep running)', click: () => { quitting = true; app.quit(); } },
    { label: 'Quit and stop all tunnels', click: () => act('Quit', async () => { await api('POST', '/api/daemon/shutdown'); quitting = true; app.quit(); }) },
  ] : [
    { label: 'Background service is not running', enabled: false },
    { label: 'Start background service', click: () => act('Start service', async () => { if (!await ensureDaemon()) throw new Error('The background service did not start.'); }) },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// A dedicated profile keeps the single-instance lock away from ~/Library/Application Support/Electron,
// which every unpackaged Electron app on the machine shares.
if (dataDir) app.setPath('userData', path.join(dataDir, 'desktop-profile'));
// app.quit() is ignored before "ready"; exit so a second launch never shows a second icon.
if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.setName('Cloudflare Tunnel Kit');
  app.on('second-instance', (_event, argv) => { if (argv.includes('--open-window')) void openWindow(); });
  // The tray keeps running with no windows open.
  app.on('window-all-closed', () => undefined);
  app.on('activate', () => void openWindow());
  app.on('before-quit', () => { quitting = true; });
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') { app.dock?.setIcon(logoPath()); app.dock?.hide(); }
    tray = new Tray(icons.idle);
    tray.setToolTip('Cloudflare Tunnel Kit');
    await ensureDaemon();
    await refresh();
    setInterval(() => void refresh(), REFRESH_MS);
    // Launched from the Dock, Finder, or Spotlight there are no flags: show the window. The service starts the tray with --background.
    if (!process.argv.includes('--background') || snapshot.settings.openWindowOnLaunch) await openWindow();
  });
}
