import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { TunnelConfig, TunnelPlan } from '../core/types.js';
import { createTunnelPlan } from '../core/plan.js';
export function detectLaravel(projectRoot = process.cwd()): boolean {
  if (!existsSync(path.join(projectRoot, 'artisan')) || !existsSync(path.join(projectRoot, 'composer.json'))) return false;
  try { return /laravel|illuminate/i.test(readFileSync(path.join(projectRoot, 'composer.json'), 'utf8')); } catch { return false; }
}
export function createLaravelPlan(input: TunnelConfig): TunnelPlan {
  const plan = createTunnelPlan({ ...input, profile: 'laravel' });
  if (!detectLaravel(plan.config.projectRoot)) {
    plan.valid = false;
    plan.issues = [{ code: 'LARAVEL_NOT_DETECTED', reason: 'artisan and Laravel composer evidence were not found.', fix: 'Run this from the Laravel project root or use profile custom.' }];
  } else {
    plan.confirmations = [...new Set([...plan.confirmations, 'laravel-env'])];
    const mappings = input.laravel ?? {};
    const envPath = path.join(plan.config.projectRoot ?? process.cwd(), '.env');
    if (existsSync(envPath) && mappings.mapAppUrl) {
      const current = readFileSync(envPath, 'utf8');
      const next = setEnv(current, 'APP_URL', plan.config.hostname ? `https://${plan.config.hostname}` : plan.config.localUrl);
      plan.fileOperations.push({ path: '.env', action: 'update', content: next, requiresConfirmation: true });
      plan.summary += ' Proposed APP_URL update is shown in the plan and needs confirmation.';
    } else if (mappings.mapAppUrl) {
      plan.valid = false;
      plan.issues = [{ code: 'LARAVEL_ENV_NOT_FOUND', reason: '.env was requested for mapping but does not exist.', fix: 'Create .env from .env.example, or disable APP_URL mapping.', field: '.env' }];
    }
    plan.summary += ' Laravel .env mappings require explicit confirmation.';
  }
  return plan;
}
function setEnv(content: string, key: string, value: string): string {
  const line = `${key}=${value}`; const expression = new RegExp(`^${key}=.*$`, 'm');
  return expression.test(content) ? content.replace(expression, line) : `${content.replace(/\s*$/, '')}\n${line}\n`;
}
