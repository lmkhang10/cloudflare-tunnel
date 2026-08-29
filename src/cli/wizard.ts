import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { TunnelPlan } from '../core/types.js';

export function formatWizardSummary(plan: Pick<TunnelPlan, 'valid'|'summary'|'issues'|'argv'|'confirmations'>): string {
  const lines = [plan.valid ? 'Validation passed.' : 'Validation failed.', plan.summary];
  for (const issue of plan.issues) lines.push(`\n[${issue.code}]${issue.field ? ` ${issue.field}` : ''}\nReason: ${issue.reason}\nFix: ${issue.fix}`);
  if (plan.valid) lines.push(`\nCommand preview: cloudflared ${plan.argv.join(' ')}`);
  if (plan.confirmations.length) lines.push(`\nConfirmation required: ${plan.confirmations.join(', ')}`);
  return lines.join('\n');
}

export function mainMenu(): string {
  return `What would you like to do?\n\n  1. Create a Quick Tunnel\n  2. Set up a custom domain\n  3. Open a saved project\n  4. Check system requirements`;
}

export async function runWizard(service: any, initialMode?: 'quick' | 'named'): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log('\nCloudflare Tunnel Kit\n');
    let mode = initialMode;
    if (!mode) {
      console.log(mainMenu());
      const choice = (await rl.question('\nChoose [1-4]: ')).trim();
      if (choice === '3') return openSaved(service, rl);
      if (choice === '4') return printDoctor(await service.doctor());
      mode = choice === '2' ? 'named' : 'quick';
    }
    const displayName = (await rl.question('Project name: ')).trim() || 'Local project';
    const projectPath = (await rl.question(`Project folder (${process.cwd()}): `)).trim() || process.cwd();
    const localUrl = (await rl.question('Local application URL (http://127.0.0.1:8000): ')).trim() || 'http://127.0.0.1:8000';
    const profileInput = (await rl.question('Project type [custom/laravel] (custom): ')).trim() || 'custom';
    const input: any = { displayName, projectPath, localUrl, profile: profileInput === 'laravel' ? 'laravel' : 'custom' };
    if (mode === 'named') {
      input.tunnelName = (await rl.question('Tunnel name: ')).trim();
      input.hostname = (await rl.question('Public hostname (for example dev.example.com): ')).trim();
    }
    const plan = mode === 'quick' ? await service.prepareQuick(input) : await service.prepareNamed(input);
    console.log('\nReview changes:'); for (const effect of plan.effects) console.log(`  - ${effect}`);
    if (mode === 'named') console.log('  - Cloudflare login may open in your browser if authentication is missing or stale.');
    const answer = (await rl.question('\nConfirm and run? [y/N]: ')).trim().toLowerCase();
    if (!['y', 'yes'].includes(answer)) { console.log('Cancelled. No changes were made.'); return; }
    console.log('\nRunning validated workflow...');
    console.log(JSON.stringify(await service.execute(plan.id, plan.confirmations), null, 2));
  } finally { rl.close(); }
}

async function openSaved(service: any, rl: any): Promise<void> {
  const projects = await service.listProjects();
  if (!projects.length) { console.log('No saved projects were found on this machine.'); return; }
  projects.forEach((project: any, index: number) => console.log(`  ${index + 1}. ${project.displayName} — ${project.status}`));
  const selected = Number((await rl.question('Choose a project: ')).trim()) - 1;
  const project = projects[selected]; if (!project) { console.log('Invalid project selection.'); return; }
  const action = (await rl.question('Action [start/stop/retry/status] (status): ')).trim() || 'status';
  if (action === 'status') console.log(JSON.stringify(await service.getProject(project.id), null, 2));
  else if (['start', 'stop', 'retry'].includes(action)) console.log(JSON.stringify(await service[action](project.id), null, 2));
  else console.log('Unknown action.');
}

function printDoctor(report: any): void {
  console.log('\nSystem requirements:');
  for (const check of report.checks) console.log(`  ${check.state === 'passed' ? '✓' : '✗'} ${check.name}: ${check.detail}`);
}
