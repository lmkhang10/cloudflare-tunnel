import type { ExecutionSummary, TunnelPlan } from './types.js';
import { runCloudflared } from '../providers/cloudflared.js';
export async function executeTunnelPlan(plan: TunnelPlan, options: { confirmed?: string[]; dryRun?: boolean } = {}): Promise<ExecutionSummary> {
  if (!plan.valid) return { ok: false, operation: plan.config.operation, passed: [], skipped: [], issues: plan.issues };
  const confirmed = new Set(options.confirmed ?? []); const missing = plan.confirmations.filter(x => !confirmed.has(x));
  if (missing.length) return { ok: false, operation: plan.config.operation, passed: [], skipped: missing, issues: [{ code: 'CONFIRMATION_REQUIRED', reason: `Confirmation required for: ${missing.join(', ')}`, fix: 'Review the plan and confirm the listed operation(s).' }] };
  if (options.dryRun) return { ok: true, operation: plan.config.operation, passed: ['validation', 'plan'], skipped: ['execution (dry-run)'], issues: [] };
  const result = await runCloudflared(plan.argv); return { ok: result.code === 0, operation: plan.config.operation, passed: result.code === 0 ? ['validation', 'execution'] : ['validation'], skipped: [], issues: result.code === 0 ? [] : [{ code: 'PROCESS_FAILED', reason: result.stderr || 'cloudflared exited with a non-zero status.', fix: 'Run cf-tunnel doctor and check cloudflared authentication.' }], output: result.stdout };
}
