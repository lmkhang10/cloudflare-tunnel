#!/usr/bin/env node
import { createServer } from '../ui/server.js';
import { createTunnelPlan, executeTunnelPlan } from '../index.js';
import { createLaravelPlan } from '../index.js';
import { runWizard } from './wizard.js';
import type { Operation, Profile, TunnelConfig } from '../core/types.js';

const args = process.argv.slice(2); const command = args[0] ?? 'init';
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
function help() { console.log(`cloudflare-tunnel-kit 0.1.0\n\nUsage: cf-tunnel <command> [options]\n\nCommands: init create quick start stop status doctor ui\nOptions: --url URL --name NAME --hostname HOST --profile custom|laravel --config PATH --dry-run --yes --no-open`); }
async function main() {
  if (command === 'init') { if (args.length === 1) return runWizard(); }
  if (command === 'help' || command === '--help') return help();
  if (command === 'ui') { const server = createServer(); server.listen(0, '127.0.0.1', () => { const a = server.address() as any; console.log(`UI ready at http://127.0.0.1:${a.port}`); }); return; }
  if (command === 'doctor') { console.log('Doctor: use `cf-tunnel quick --url http://127.0.0.1:8000 --dry-run` to validate a project without starting cloudflared.'); return; }
  const operation = (command === 'init' ? 'create' : command) as Operation;
  const config: TunnelConfig = { profile: (value('--profile') as Profile) ?? 'custom', operation, localUrl: value('--url') ?? 'http://127.0.0.1:8000', tunnelName: value('--name'), hostname: value('--hostname'), configPath: value('--config') };
  const plan = config.profile === 'laravel' ? createLaravelPlan(config) : createTunnelPlan(config); console.log(JSON.stringify({ summary: plan.summary, issues: plan.issues, argv: plan.argv, confirmations: plan.confirmations }, null, 2));
  if (!plan.valid || args.includes('--dry-run')) return;
  const result = await executeTunnelPlan(plan, { confirmed: args.includes('--yes') ? plan.confirmations : [] }); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1;
}
main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
