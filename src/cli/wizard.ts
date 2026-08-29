import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createTunnelPlan } from '../core/plan.js';
import { createLaravelPlan } from '../adapters/laravel.js';
import { executeTunnelPlan } from '../core/execution.js';
import type { Profile, TunnelConfig, TunnelPlan } from '../core/types.js';

export function formatWizardSummary(plan: Pick<TunnelPlan, 'valid'|'summary'|'issues'|'argv'|'confirmations'>): string {
  const lines = [plan.valid ? 'Validation passed.' : 'Validation failed.', plan.summary];
  for (const i of plan.issues) lines.push(`\n[${i.code}]${i.field ? ` ${i.field}` : ''}\nReason: ${i.reason}\nFix: ${i.fix}`);
  if (plan.valid) lines.push(`\nCommand preview: cloudflared ${plan.argv.join(' ')}`);
  if (plan.confirmations.length) lines.push(`\nConfirmation required: ${plan.confirmations.join(', ')}`);
  return lines.join('\n');
}

export async function runWizard(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const profileInput = (await rl.question('Profile [custom/laravel] (custom): ')).trim() || 'custom';
    const operationInput = (await rl.question('Operation [quick/create] (quick): ')).trim() || 'quick';
    const localUrl = (await rl.question('Local URL (http://127.0.0.1:8000): ')).trim() || 'http://127.0.0.1:8000';
    const tunnelName = (await rl.question('Tunnel name (optional): ')).trim() || undefined;
    const hostname = (await rl.question('Hostname (optional): ')).trim() || undefined;
    const config: TunnelConfig = { profile: profileInput as Profile, operation: operationInput as 'quick'|'create', localUrl, tunnelName, hostname };
    const plan = config.profile === 'laravel' ? createLaravelPlan(config) : createTunnelPlan(config);
    console.log(`\n${formatWizardSummary(plan)}`);
    if (!plan.valid) return;
    const answer = (await rl.question('\nExecute this plan? [y/N]: ')).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') console.log(JSON.stringify(await executeTunnelPlan(plan, { confirmed: plan.confirmations }), null, 2));
    else console.log('Cancelled. No changes were made.');
  } finally { rl.close(); }
}
