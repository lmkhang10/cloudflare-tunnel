#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createServer } from '../ui/server.js';
import { createTunnelPlan, executeTunnelPlan } from '../index.js';
import { createLaravelPlan } from '../index.js';
import { launchBrowser } from '../providers/browser.js';
import { runWizard } from './wizard.js';
import type { Operation, Profile, TunnelConfig } from '../core/types.js';

const args = process.argv.slice(2); const command = args[0] ?? 'init';
const packageVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function help() { console.log(`cloudflare-tunnel-kit ${packageVersion}\n\nUsage from an installed project:\n  npx cf-tunnel\n  npx cf-tunnel ui\n\nCommands: init create quick start stop status doctor ui\nOptions: --url URL --name NAME --hostname HOST --profile custom|laravel --config PATH --dry-run --yes --no-open`); }
async function main() {
  if (command === 'init') { if (args.length === 1) return runWizard(); }
  if (command === 'help' || command === '--help') return help();
  if (command === 'ui') {
    console.log('Starting Cloudflare Tunnel Kit UI on this machine...');
    const server = createServer();
    server.once('error', error => {
      console.error(`Unable to start the local UI: ${error.message}`);
      console.error('Check whether local server processes are allowed, then run `npx cf-tunnel ui` again.');
      process.exitCode = 1;
    });
    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') return;
      const url = `http://127.0.0.1:${address.port}`;
      console.log(`UI ready at ${url}`);
      if (!args.includes('--no-open')) {
        const result = await launchBrowser(url);
        console.log(result.message);
      }
    });
    return;
  }
  if (command === 'doctor') { console.log('Doctor: use `cf-tunnel quick --url http://127.0.0.1:8000 --dry-run` to validate a project without starting cloudflared.'); return; }
  const operation = (command === 'init' ? 'create' : command) as Operation;
  const config: TunnelConfig = { profile: (value('--profile') as Profile) ?? 'custom', operation, localUrl: value('--url') ?? 'http://127.0.0.1:8000', tunnelName: value('--name'), hostname: value('--hostname'), configPath: value('--config') };
  const plan = config.profile === 'laravel' ? createLaravelPlan(config) : createTunnelPlan(config); console.log(JSON.stringify({ summary: plan.summary, issues: plan.issues, argv: plan.argv, confirmations: plan.confirmations }, null, 2));
  if (!plan.valid || args.includes('--dry-run')) return;
  const result = await executeTunnelPlan(plan, { confirmed: args.includes('--yes') ? plan.confirmations : [] }); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
