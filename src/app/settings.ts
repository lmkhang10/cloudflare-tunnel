export type SettingGroup = 'general' | 'tunnels' | 'cloudflared' | 'notifications' | 'updates';

type Descriptor =
  | { type: 'boolean'; default: boolean }
  | { type: 'integer'; default: number; min: number; max: number }
  | { type: 'enum'; default: string; values: readonly string[] }
  | { type: 'string'; default: string; maxLength: number };

export type SettingDefinition = Descriptor & { key: string; group: SettingGroup; label: string; hint?: string };

export const settingDefinitions = [
  { key: 'trayEnabled', group: 'general', type: 'boolean', default: true, label: 'Show the menu bar icon', hint: 'Start the tray app together with the background service when the desktop runtime is installed.' },
  { key: 'openWindowOnLaunch', group: 'general', type: 'boolean', default: false, label: 'Open the window when the tray starts' },
  { key: 'showDockIcon', group: 'general', type: 'boolean', default: false, label: 'Show the Dock icon (macOS)', hint: 'Off keeps the app in the menu bar only.' },
  { key: 'uiPort', group: 'general', type: 'integer', default: 0, min: 0, max: 65535, label: 'Local UI port', hint: '0 picks a free port. A fixed port keeps bookmarks stable. Applies after the service restarts.' },
  { key: 'restoreTunnelsOnLaunch', group: 'tunnels', type: 'boolean', default: true, label: 'Start auto-start projects when the service launches' },
  { key: 'autoRestartOnCrash', group: 'tunnels', type: 'boolean', default: true, label: 'Restart a connector that exits unexpectedly' },
  { key: 'maxRestartAttempts', group: 'tunnels', type: 'integer', default: 5, min: 1, max: 50, label: 'Restart attempts before giving up' },
  { key: 'cloudflaredPath', group: 'cloudflared', type: 'string', default: '', maxLength: 1024, label: 'cloudflared executable', hint: 'Leave empty to find cloudflared on PATH.' },
  { key: 'protocol', group: 'cloudflared', type: 'enum', default: 'auto', values: ['auto', 'quic', 'http2'], label: 'Edge protocol', hint: 'Use http2 on networks that block UDP.' },
  { key: 'noAutoupdate', group: 'cloudflared', type: 'boolean', default: true, label: 'Disable cloudflared self-update while managed', hint: 'Prevents cloudflared from restarting itself outside the supervisor.' },
  { key: 'logLevel', group: 'cloudflared', type: 'enum', default: 'info', values: ['debug', 'info', 'warn', 'error', 'fatal'], label: 'Connector log level' },
  { key: 'notifyOnDisconnect', group: 'notifications', type: 'boolean', default: true, label: 'Notify when a connector stops unexpectedly' },
  { key: 'notifyOnQuickUrl', group: 'notifications', type: 'boolean', default: true, label: 'Notify when a Quick Tunnel receives a new URL' },
  { key: 'checkForUpdates', group: 'updates', type: 'boolean', default: true, label: 'Check for updates automatically', hint: 'Reads the public npm registry and GitHub releases. Nothing about this machine is sent.' },
  { key: 'autoInstallUpdates', group: 'updates', type: 'boolean', default: false, label: 'Install cftunnel updates automatically', hint: 'Only for global npm installs. Running tunnels restart briefly.' },
  { key: 'updateCheckIntervalHours', group: 'updates', type: 'integer', default: 24, min: 1, max: 720, label: 'Hours between update checks' },
  { key: 'defaultAccountId', group: 'tunnels', type: 'string', default: '', maxLength: 64, label: 'Default Cloudflare account' },
] as const satisfies readonly SettingDefinition[];

type Definitions = typeof settingDefinitions[number];
type ValueOf<D> = D extends { type: 'boolean' } ? boolean : D extends { type: 'integer' } ? number : string;
export type AppSettings = { [D in Definitions as D['key']]: ValueOf<D> };

const byKey = new Map<string, SettingDefinition>(settingDefinitions.map(definition => [definition.key, definition]));

export const defaultSettings: AppSettings = Object.fromEntries(settingDefinitions.map(definition => [definition.key, definition.default])) as AppSettings;

export function resolveSettings(stored: Record<string, unknown>): AppSettings {
  const settings: Record<string, unknown> = { ...defaultSettings };
  for (const [key, value] of Object.entries(stored)) {
    const definition = byKey.get(key);
    if (definition && validValue(definition, value)) settings[key] = value;
  }
  return settings as AppSettings;
}

export function validateSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Settings must be an object.');
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch)) {
    const definition = byKey.get(key);
    if (!definition) throw new Error(`Unknown setting: ${key}`);
    const value = coerce(definition, raw);
    if (!validValue(definition, value)) throw new Error(`Invalid value for ${key}.${describe(definition)}`);
    result[key] = value;
  }
  return result as Partial<AppSettings>;
}

function coerce(definition: SettingDefinition, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  if (definition.type === 'boolean' && ['true', 'false'].includes(raw)) return raw === 'true';
  if (definition.type === 'integer' && /^-?\d+$/.test(raw.trim())) return Number(raw);
  if (definition.type === 'string') return raw.trim();
  return raw;
}

function validValue(definition: SettingDefinition, value: unknown): boolean {
  if (definition.type === 'boolean') return typeof value === 'boolean';
  if (definition.type === 'integer') return Number.isInteger(value) && (value as number) >= definition.min && (value as number) <= definition.max;
  if (definition.type === 'enum') return typeof value === 'string' && definition.values.includes(value);
  return typeof value === 'string' && value.length <= definition.maxLength && !/[\0\n\r]/.test(value);
}

function describe(definition: SettingDefinition): string {
  if (definition.type === 'integer') return ` Use an integer from ${definition.min} to ${definition.max}.`;
  if (definition.type === 'enum') return ` Use one of: ${definition.values.join(', ')}.`;
  if (definition.type === 'boolean') return ' Use true or false.';
  return ` Use at most ${definition.maxLength} characters.`;
}
