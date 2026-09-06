import { createServer as httpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import crypto from 'node:crypto';
import { dashboardPage } from './page.js';

const emptyService = {
  listProjects: async () => [], getProject: async () => ({}), doctor: async () => ({ ok: true, checks: [] }),
  prepareQuick: async (input: any) => ({ id: 'preview', effects: [`Start Quick Tunnel to ${input.localUrl}.`], confirmations: ['start-connector'] }),
  prepareNamed: async (input: any) => ({ id: 'preview', effects: [`Create ${input.hostname}.`], confirmations: ['cloudflare-resources', 'start-connector'] }),
  execute: async () => ({ state: 'skipped', message: 'No service configured.' }), start: async () => ({}), stop: async () => ({}), retry: async () => ({}), restart: async () => ({}),
};

export function createServer(options: { service?: any; sessionToken?: string; maxBodyBytes?: number; version?: string } = {}): Server {
  const service = options.service ?? emptyService; const token = options.sessionToken ?? crypto.randomUUID(); const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  return httpServer(async (req, res) => {
    secureHeaders(res);
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/') return html(res, dashboardPage(options.version));
    if (req.method === 'GET' && url.pathname === '/api/session') return json(res, { confirmationToken: token });
    if (req.method === 'GET' && url.pathname === '/api/projects') return handle(res, async () => ({ projects: await service.listProjects() }));
    if (req.method === 'GET' && url.pathname === '/api/doctor') return handle(res, () => service.doctor());
    const detail = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
    if (req.method === 'GET' && detail) return handle(res, () => service.getProject(detail[1]));
    if (req.method === 'POST') {
      if (!validMutationRequest(req, token)) return json(res, { error: 'The local UI session is missing or invalid. Reload the page and try again.' }, 403);
      if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return json(res, { error: 'Requests must use application/json.' }, 415);
      let body: any; try { body = JSON.parse(await readBody(req, maxBodyBytes)); } catch (error) { return json(res, { error: error instanceof Error ? error.message : 'Invalid JSON request.' }, (error as any)?.code === 'BODY_TOO_LARGE' ? 413 : 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || containsCredentialField(body)) return json(res, { error: 'Requests must be objects and must not contain secret or credential fields.' }, 400);
      if (url.pathname === '/api/plans/quick') return handle(res, () => service.prepareQuick(body));
      if (url.pathname === '/api/plans/named') return handle(res, () => service.prepareNamed(body));
      if (url.pathname === '/api/execute') return handle(res, () => service.execute(body.planId, body.confirmations ?? []));
      const action = url.pathname.match(/^\/api\/projects\/([^/]+)\/(start|stop|retry|restart)$/);
      if (action) return handle(res, () => service[action[2]](action[1]));
      const management = url.pathname.match(/^\/api\/projects\/([^/]+)\/(relink|remove-local)$/);
      if (management) return handle(res, () => management[2] === 'relink' ? service.relinkProject(management[1], body.path) : service.removeLocal(management[1]));
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
  const host = String(req.headers.host ?? ''); if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) return false;
  const origin = String(req.headers.origin ?? ''); return !origin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
}
function readBody(req: IncomingMessage, limit: number): Promise<string> { return new Promise((resolve, reject) => { let data = '', size = 0; req.on('data', chunk => { size += chunk.length; if (size > limit) { const error: any = new Error('Request body is too large.'); error.code = 'BODY_TOO_LARGE'; reject(error); req.destroy(); return; } data += chunk; }); req.on('end', () => resolve(data || '{}')); req.on('error', reject); }); }
async function handle(res: ServerResponse, operation: () => Promise<any>) { try { return json(res, await operation()); } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400); } }
function secureHeaders(res: ServerResponse) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Cache-Control', 'no-store'); }
function html(res: ServerResponse, value: string) { res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(value); }
function json(res: ServerResponse, value: unknown, status = 200) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
