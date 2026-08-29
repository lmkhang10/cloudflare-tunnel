import { createServer as httpServer, type Server } from 'node:http';
import crypto from 'node:crypto';
import { createTunnelPlan } from '../core/plan.js';
import { createLaravelPlan } from '../adapters/laravel.js';
import { executeTunnelPlan } from '../core/execution.js';
import type { TunnelConfig } from '../core/types.js';

export function createServer(): Server {
  const token = crypto.randomUUID();
  return httpServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return; }
    if (req.method === 'GET' && req.url === '/api/session') return json(res, { confirmationToken: token });
    if (req.method === 'POST' && ['/api/plan', '/api/validate', '/api/execute'].includes(req.url ?? '')) {
      if (req.url === '/api/execute' && req.headers['x-confirmation-token'] !== token) return json(res, { ok: false, issues: [{ code: 'UI_CONFIRMATION_TOKEN_INVALID', reason: 'The UI confirmation token is missing or invalid.', fix: 'Reload the local UI and confirm from the same browser session.' }] }, 403);
      try {
        const body = JSON.parse(await readBody(req)); const config = body.config as TunnelConfig;
        const plan = config.profile === 'laravel' ? createLaravelPlan(config) : createTunnelPlan(config);
        if (req.url === '/api/execute') return json(res, await executeTunnelPlan(plan, { confirmed: body.confirmed ?? [], dryRun: body.dryRun ?? false }));
        return json(res, { valid: plan.valid, issues: plan.issues, plan });
      } catch { return json(res, { ok: false, issues: [{ code: 'UI_INVALID_JSON', reason: 'Request body is not valid JSON.', fix: 'Submit the wizard form again.' }] }, 400); }
    }
    res.statusCode = 404; res.end('Not found');
  });
}
function readBody(req: any): Promise<string> { return new Promise(resolve => { let data = ''; req.on('data', (chunk: any) => data += chunk); req.on('end', () => resolve(data)); }); }
function json(res: any, value: unknown, status = 200) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(value)); }
const html = `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Cloudflare Tunnel Kit</title><style>body{font:16px system-ui;max-width:720px;margin:40px auto;padding:0 20px;background:#f6f7fb;color:#18202a}main{background:white;padding:28px;border-radius:16px;box-shadow:0 8px 30px #0001}label{display:block;margin:14px 0 6px}input,select,button{font:inherit;padding:10px;border:1px solid #ccd3df;border-radius:8px;width:100%;box-sizing:border-box}button{margin-top:20px;background:#2457d6;color:white;cursor:pointer}pre{white-space:pre-wrap;background:#f1f3f7;padding:12px;border-radius:8px}.ok{color:#087443}.error{color:#a21b1b}</style><main><h1>Cloudflare Tunnel Kit</h1><p>Validate first. Review the plan. Confirm before running.</p><label>Profile</label><select id="profile"><option>custom</option><option>laravel</option></select><label>Local URL</label><input id="url" value="http://127.0.0.1:8000"><label>Tunnel name (named tunnel only)</label><input id="name" placeholder="my-project"><button id="check">Validate plan</button><button id="run" hidden>Confirm and execute</button><button id="copy" hidden>Copy AI help prompt</button><pre id="result">No plan yet.</pre></main><script>let plan,token;const $=id=>document.getElementById(id);fetch('/api/session').then(r=>r.json()).then(x=>token=x.confirmationToken);$('check').onclick=async()=>{const config={profile:$('profile').value,operation:$('name').value?'create':'quick',localUrl:$('url').value,tunnelName:$('name').value||undefined};const r=await fetch('/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config})});const x=await r.json();plan=x.plan;$('result').textContent=JSON.stringify({summary:plan?.summary,issues:x.issues,argv:plan?.argv,confirmations:plan?.confirmations},null,2);$('run').hidden=!x.valid;$('copy').hidden=x.valid;};$('run').onclick=async()=>{const r=await fetch('/api/execute',{method:'POST',headers:{'content-type':'application/json','x-confirmation-token':token},body:JSON.stringify({config:plan.config,confirmed:plan.confirmations})});$('result').textContent=JSON.stringify(await r.json(),null,2);};$('copy').onclick=()=>navigator.clipboard.writeText('I am configuring cloudflare-tunnel-kit. Here is the redacted diagnostic:\n'+$('result').textContent);</script>`;
