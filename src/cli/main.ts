#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { stdin } from 'node:process';
import { createServer } from '../ui/server.js';
import { launchBrowser } from '../providers/browser.js';
import { createTunnelKitService } from '../app/service.js';
import { runWizard } from './wizard.js';

const args = process.argv.slice(2); const command = args[0] ?? 'init';
const packageVersion = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
function help() { console.log(`cloudflare-tunnel-kit ${packageVersion}\n\nUsage from an installed project:\n  npx cf-tunnel\n  npx cf-tunnel ui\n\nCommands: init create quick start stop restart status doctor ui\nOptions: --url URL --name NAME --hostname HOST --profile custom|laravel --project ID --dry-run --yes --json --no-open`); }
function interactiveRequired(): never { console.error('[INTERACTIVE_INPUT_REQUIRED] This command needs wizard input, but the terminal is not interactive.\nRun `npx cf-tunnel ui` or provide all required flags with `--yes`.'); process.exit(2); }

async function startUi() {
  console.log('Starting Cloudflare Tunnel Kit UI on this machine...');
  const service = createTunnelKitService({ dataDir: process.env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR }); const server = createServer({ service });
  server.once('error', error => { console.error(`Unable to start the local UI: ${error.message}`); console.error('Run `npx cf-tunnel ui` again after checking local server permissions.'); process.exitCode = 1; service.close(); });
  server.listen(0, '127.0.0.1', async () => { const address = server.address(); if (!address || typeof address === 'string') return; const url = `http://127.0.0.1:${address.port}`; console.log(`UI ready at ${url}`); if (!args.includes('--no-open')) console.log((await launchBrowser(url)).message); });
  process.once('SIGINT', () => server.close(() => { service.close(); process.exit(130); }));
}

async function main() {
  if (['help', '--help', '-h'].includes(command)) return help();
  if (command === 'ui') return startUi();
  if (command === 'init' && !stdin.isTTY) interactiveRequired();
  const service = createTunnelKitService({ dataDir: process.env.CLOUDFLARE_TUNNEL_KIT_DATA_DIR });
  if (command === 'init') return runWizard(service);
  if (command === 'doctor') { const report = await service.doctor(); console.log(JSON.stringify(report, null, 2)); service.close(); return; }
  if (command === 'quick' || command === 'create') {
    const mode = command === 'quick' ? 'quick' : 'named';
    const localUrl = value('--url'); const tunnelName = value('--name'); const hostname = value('--hostname');
    if (!localUrl || (mode === 'named' && (!tunnelName || !hostname))) { if (!stdin.isTTY) interactiveRequired(); return runWizard(service, mode); }
    const input = { projectPath: value('--path') ?? process.cwd(), displayName: value('--project-name'), profile: value('--profile') === 'laravel' ? 'laravel' : 'custom', localUrl, tunnelName, hostname };
    const plan = mode === 'quick' ? await service.prepareQuick(input) : await service.prepareNamed(input);
    if (args.includes('--dry-run')) { console.log(JSON.stringify(plan, null, 2)); service.close(); return; }
    if (!args.includes('--yes')) { if (!stdin.isTTY) interactiveRequired(); return runWizard(service, mode); }
    console.log(JSON.stringify(await service.execute(plan.id, plan.confirmations), null, 2)); return;
  }
  if (['start', 'stop', 'restart', 'status', 'retry'].includes(command)) {
    const projectId = value('--project');
    if (!projectId) { if (!stdin.isTTY) interactiveRequired(); return runWizard(service); }
    const result = command === 'status' ? await service.getProject(projectId)
      : command === 'start' ? await service.start(projectId)
      : command === 'stop' ? await service.stop(projectId)
      : command === 'restart' ? await service.restart(projectId)
      : await service.retry(projectId);
    console.log(JSON.stringify(result, null, 2)); if (command === 'status' || command === 'stop') service.close(); return;
  }
  help(); process.exitCode = 2; service.close();
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
