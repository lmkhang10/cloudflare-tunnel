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
  AUTH_REQUIRED: {
    title: 'Cloudflare account not connected',
    summary: () => 'cloudflared could not find a Cloudflare account certificate for this operation.',
    likelyCause: 'No account has been connected yet, or the selected account certificate was moved or deleted.',
    remediationSteps: ['Connect a Cloudflare account in Settings → Accounts, or run `cftunnel account login`.', 'Select that account for the project and retry.'],
    availableActions: ['sign-in-again', 'retry', 'copy-diagnostics'],
    retryFromStep: 'authentication',
  },
  AUTH_STALE: {
    title: 'Cloudflare login has expired',
    summary: () => 'The saved Cloudflare account certificate is no longer accepted.',
    likelyCause: 'The account permissions changed, the login was revoked, or the certificate is stale.',
    remediationSteps: ['Sign in to Cloudflare again.', 'Retry the interrupted workflow step.'],
    availableActions: ['sign-in-again', 'retry', 'copy-diagnostics'],
    retryFromStep: 'authentication',
  },
  DNS_RECORD_EXISTS: {
    title: 'The hostname already has a DNS record',
    summary: context => `${context.hostname ?? 'This hostname'} already has an A, AAAA, or CNAME record, often from an older tunnel.`,
    likelyCause: 'The hostname was used before. Existing DNS records are never replaced without confirmation.',
    remediationSteps: ['Choose "Replace DNS record" to point the hostname at this tunnel, or use another hostname.'],
    availableActions: ['replace-dns', 'change-input', 'copy-diagnostics'],
    retryFromStep: 'dns-route',
  },
  CLOUDFLARED_OUTPUT_UNRECOGNIZED: {
    title: 'Cloudflare output was not recognized',
    summary: () => 'cloudflared completed, but its output did not contain expected resource information.',
    likelyCause: 'The installed cloudflared version may use an unsupported output format.',
    remediationSteps: ['Check the installed cloudflared version.', 'Copy the redacted diagnostics when reporting this compatibility issue.'],
    availableActions: ['retry', 'copy-diagnostics'],
  },
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
