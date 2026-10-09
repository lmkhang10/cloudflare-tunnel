import { createServer as httpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dashboardPage } from './page.js';

const emptyService = {
  listProjects: async () => [], getProject: async () => ({}), doctor: async () => ({ ok: true, checks: [] }),
  prepareQuick: async (input: any) => ({ id: 'preview', effects: [`Start Quick Tunnel to ${input.localUrl}.`], confirmations: ['start-connector'] }),
  prepareNamed: async (input: any) => ({ id: 'preview', effects: [`Create ${input.hostname}.`], confirmations: ['cloudflare-resources', 'start-connector'] }),
  execute: async () => ({ state: 'skipped', message: 'No service configured.' }), start: async () => ({}), stop: async () => ({}), retry: async () => ({}), restart: async () => ({}),
};

/** Hooks only the background daemon provides; the foreground `ui --foreground` server omits them. */
export interface DaemonControls { pid: number; startedAt: string; shutdown(options?: { resume?: boolean }): Promise<unknown>; installUpdate(): Promise<unknown>; }

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost)(:\d+)?$/i;
const images = new Map<string, Buffer | null>();
function image(name: 'logo.png' | 'favicon.png'): Buffer | null {
  if (!images.has(name)) { try { images.set(name, readFileSync(new URL(`../../assets/${name}`, import.meta.url))); } catch { images.set(name, null); } }
  return images.get(name)!;
}

/**
 * Pushes the project list to dashboards over Server-Sent Events, only when it changes.
 * One shared check runs while at least one dashboard is connected.
 */
function projectStream(service: any, intervalMs: number) {
  const clients = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | undefined; let last = ''; let checking = false;
  const send = (res: ServerResponse, payload: string) => res.write(`event: projects\ndata: ${payload}\n\n`);
  const check = async () => {
    if (checking) return; checking = true;
    try { const payload = JSON.stringify({ projects: await service.listProjects() }); if (payload !== last) { last = payload; for (const res of clients) send(res, payload); } }
    catch {} finally { checking = false; }
  };
  return {
    async open(req: IncomingMessage, res: ServerResponse) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      if (last) send(res, last); else await check();
      timer ??= setInterval(() => { void check(); for (const client of clients) client.write(': keep-alive\n\n'); }, intervalMs);
      req.on('close', () => { clients.delete(res); if (!clients.size) { clearInterval(timer); timer = undefined; last = ''; } });
    },
  };
}

export function createServer(options: { service?: any; sessionToken?: string; maxBodyBytes?: number; version?: string; daemon?: DaemonControls; streamIntervalMs?: number } = {}): Server {
  const service = options.service ?? emptyService; const token = options.sessionToken ?? crypto.randomUUID(); const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const call = (name: string, ...args: unknown[]) => { if (typeof service[name] !== 'function') throw new Error('This feature is not available in this mode.'); return service[name](...args); };
  const stream = projectStream(service, options.streamIntervalMs ?? 1_000);
  return httpServer(async (req, res) => {
    secureHeaders(res);
    // Every route checks Host, so a DNS-rebound page cannot read the session token from a long-running service.
    if (!LOOPBACK_HOST.test(String(req.headers.host ?? ''))) return json(res, { error: 'Requests must target 127.0.0.1 or localhost.' }, 403);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const id = (value: string) => decodeURIComponent(value);
    if (req.method === 'GET') {
      if (url.pathname === '/api/stream') return stream.open(req, res);
      if (url.pathname === '/') return html(res, dashboardPage(options.version, { shell: url.searchParams.get('shell') === 'desktop' ? 'desktop' : 'browser', daemon: Boolean(options.daemon) }));
      if (url.pathname === '/logo.png' || url.pathname === '/favicon.png') {
        const body = image(url.pathname.slice(1) as 'logo.png' | 'favicon.png');
        if (!body) return json(res, { error: 'Not found.' }, 404);
        res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); res.end(body); return;
      }
      if (url.pathname === '/api/health') return json(res, { ok: true, version: options.version, pid: options.daemon?.pid ?? process.pid, startedAt: options.daemon?.startedAt, daemon: Boolean(options.daemon) });
      if (url.pathname === '/api/session') return json(res, { confirmationToken: token });
      if (url.pathname === '/api/projects') return handle(res, async () => ({ projects: await service.listProjects() }));
      if (url.pathname === '/api/doctor') return handle(res, () => service.doctor());
      if (url.pathname === '/api/settings') return handle(res, async () => call('settingsView'));
      if (url.pathname === '/api/accounts') return handle(res, async () => call('listAccounts'));
      if (url.pathname === '/api/accounts/discover') return handle(res, async () => call('discoverAccounts'));
      if (url.pathname === '/api/autostart') return handle(res, () => call('autostartStatus'));
      if (url.pathname === '/api/updates') return handle(res, async () => call('updateStatus'));
      if (url.pathname === '/api/events') return handle(res, async () => call('listEvents', Number(url.searchParams.get('after') ?? 0) || 0));
      const login = url.pathname.match(/^\/api\/accounts\/login\/([^/]+)$/);
      if (login) return handle(res, async () => call('getAccountLogin', id(login[1])));
      const detail = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (detail) return handle(res, () => service.getProject(id(detail[1])));
    }
    if (req.method === 'POST') {
      if (!validMutationRequest(req, token)) return json(res, { error: 'The local UI session is missing or invalid. Reload the page and try again.' }, 403);
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return json(res, { error: 'Requests must use application/json.' }, 415);
      let body: any; try { body = JSON.parse(await readBody(req, maxBodyBytes)); } catch (error) { return json(res, { error: error instanceof Error ? error.message : 'Invalid JSON request.' }, (error as any)?.code === 'BODY_TOO_LARGE' ? 413 : 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || containsCredentialField(body)) return json(res, { error: 'Requests must be objects and must not contain secret or credential fields.' }, 400);
      if (url.pathname === '/api/plans/quick') return handle(res, () => service.prepareQuick(body));
      if (url.pathname === '/api/plans/named') return handle(res, () => service.prepareNamed(body));
      if (url.pathname === '/api/execute') return handle(res, () => service.execute(body.planId, body.confirmations ?? []));
      if (url.pathname === '/api/projects/start-all') return handle(res, async () => ({ results: await call('startAll') }));
      if (url.pathname === '/api/projects/stop-all') return handle(res, async () => { await call('stopAll'); return { stopped: true }; });
      if (url.pathname === '/api/settings') return handle(res, async () => call('updateSettings', body));
      if (url.pathname === '/api/autostart') return handle(res, () => call('setAutostart', body.enabled));
      if (url.pathname === '/api/accounts/import') return handle(res, async () => call('importAccount', body));
      if (url.pathname === '/api/accounts/login') return handle(res, async () => call('startAccountLogin', body));
      if (url.pathname === '/api/updates/check') return handle(res, () => call('checkForUpdates'));
      if (url.pathname === '/api/updates/install') return handle(res, () => options.daemon ? options.daemon.installUpdate() : Promise.reject(new Error('Updates are installed by the background service. Run `cftunnel update`.')));
      if (url.pathname === '/api/daemon/shutdown') return handle(res, () => options.daemon ? options.daemon.shutdown({ resume: body.resume === true }) : Promise.reject(new Error('This UI is not running as the background service.')));
      const account = url.pathname.match(/^\/api\/accounts\/([^/]+)\/(verify|rename|remove|default)$/);
      if (account) {
        const accountId = id(account[1]);
        return handle(res, async () => account[2] === 'verify' ? call('verifyAccount', accountId) : account[2] === 'rename' ? call('renameAccount', accountId, body.label) : account[2] === 'default' ? call('setDefaultAccount', accountId) : (call('removeAccount', accountId), { removed: true }));
      }
      const action = url.pathname.match(/^\/api\/projects\/([^/]+)\/(start|stop|retry|restart|replace-dns)$/);
      if (action) return handle(res, () => action[2] === 'replace-dns' ? call('replaceDns', id(action[1])) : service[action[2]](id(action[1])));
      const management = url.pathname.match(/^\/api\/projects\/([^/]+)\/(relink|remove-local|settings)$/);
      if (management) return handle(res, () => management[2] === 'relink' ? service.relinkProject(id(management[1]), body.path) : management[2] === 'settings' ? call('updateProjectSettings', id(management[1]), body) : service.removeLocal(id(management[1])));
      if (url.pathname === '/api/plan') {
        const config = body.config ?? {}; return handle(res, async () => ({ plan: config.operation === 'quick' ? await service.prepareQuick({ projectPath: config.projectRoot ?? process.cwd(), ...config }) : await service.prepareNamed({ projectPath: config.projectRoot ?? process.cwd(), ...config }) }));
      }
    }
    return json(res, { error: 'Not found.' }, 404);
  });
}
function containsCredentialField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsCredentialField);
  return Object.entries(value).some(([key, nested]) => /(secret|token|password|credential|private[_-]?key|cert)/i.test(key) || containsCredentialField(nested));
}

function validMutationRequest(req: IncomingMessage, token: string): boolean {
  const received = String(req.headers['x-confirmation-token'] ?? '');
  if (received.length !== token.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(token))) return false;
  const host = String(req.headers.host ?? ''); if (!LOOPBACK_HOST.test(host)) return false;
  const origin = String(req.headers.origin ?? ''); return !origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
}
function readBody(req: IncomingMessage, limit: number): Promise<string> { return new Promise((resolve, reject) => { let data = '', size = 0; req.on('data', chunk => { size += chunk.length; if (size > limit) { const error: any = new Error('Request body is too large.'); error.code = 'BODY_TOO_LARGE'; reject(error); req.destroy(); return; } data += chunk; }); req.on('end', () => resolve(data || '{}')); req.on('error', reject); }); }
async function handle(res: ServerResponse, operation: () => Promise<any>) { try { return json(res, (await operation()) ?? {}); } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error), issues: (error as any)?.issues }, 400); } }
function secureHeaders(res: ServerResponse) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store'); }
function html(res: ServerResponse, value: string) { res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(value); }
function json(res: ServerResponse, value: unknown, status = 200) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
