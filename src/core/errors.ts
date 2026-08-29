import type { NamedStep, RecoveryAction, TunnelError, ValidationIssue } from './types.js';
import { redact } from './redact.js';

export class TunnelKitError extends Error {
  constructor(public readonly issue: ValidationIssue) { super(`${issue.code}: ${issue.reason}`); this.name = 'TunnelKitError'; }
}

interface ErrorContext {
  hostname?: string;
  completedEffects?: string[];
  exitCode?: number;
  stderr?: string;
}

interface ErrorDefinition {
  title: string;
  summary(context: ErrorContext): string;
  likelyCause: string;
  remediationSteps: string[];
  availableActions: RecoveryAction[];
  retryFromStep?: NamedStep;
}

const definitions: Record<string, ErrorDefinition> = {
  DNS_PERMISSION_DENIED: {
    title: 'DNS permission denied',
    summary: context => `Cloudflare did not allow this account to create a DNS record for ${context.hostname ?? 'the requested hostname'}.`,
    likelyCause: 'The selected account or zone does not have permission to create DNS records for this hostname.',
    remediationSteps: [
      'Sign in again with an account that manages the requested domain.',
      'Select the correct zone during Cloudflare login.',
      'Retry the DNS step after access is corrected.',
    ],
    availableActions: ['sign-in-again', 'retry', 'copy-diagnostics'],
    retryFromStep: 'dns-route',
  },
  CLOUDFLARED_COMMAND_FAILED: {
    title: 'Cloudflare command failed',
    summary: () => 'cloudflared exited before the requested operation completed.',
    likelyCause: 'The command returned an error that Cloudflare Tunnel Kit does not recognize yet.',
    remediationSteps: ['Review the redacted diagnostics.', 'Retry after correcting the reported Cloudflare or local environment issue.'],
    availableActions: ['retry', 'copy-diagnostics'],
  },
};

export function tunnelError(code: string, context: ErrorContext = {}): TunnelError {
  const definition = definitions[code] ?? definitions.CLOUDFLARED_COMMAND_FAILED;
  const safeDiagnostics = context.exitCode === undefined && context.stderr === undefined
    ? undefined
    : { exitCode: context.exitCode, stderr: redact(context.stderr ?? '') };
  return {
    code: definitions[code] ? code : 'CLOUDFLARED_COMMAND_FAILED',
    title: definition.title,
    summary: definition.summary(context),
    likelyCause: definition.likelyCause,
    completedEffects: context.completedEffects ?? [],
    remediationSteps: definition.remediationSteps,
    availableActions: definition.availableActions,
    safeDiagnostics,
    retryFromStep: definition.retryFromStep,
  };
}
