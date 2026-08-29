export type Profile = 'custom' | 'laravel';
export type Operation = 'quick' | 'create' | 'start' | 'stop' | 'status';
export type TunnelKind = 'quick' | 'named';
export type WorkflowStepState = 'pending' | 'running' | 'succeeded' | 'warning' | 'failed' | 'skipped' | 'cancelled';
export type NamedStep =
  | 'environment' | 'input' | 'origin' | 'filesystem' | 'git-safety'
  | 'authentication' | 'account-access' | 'tunnel' | 'configuration'
  | 'ingress-validation' | 'dns-route' | 'connector'
  | 'cloudflare-health' | 'public-health';
export type RecoveryAction =
  | 'retry' | 'sign-in-again' | 'change-input' | 'open-dashboard'
  | 'copy-diagnostics' | 'stop' | 'force-stop';

export interface TunnelError {
  code: string;
  title: string;
  summary: string;
  likelyCause: string;
  completedEffects: string[];
  remediationSteps: string[];
  availableActions: RecoveryAction[];
  safeDiagnostics?: Record<string, unknown>;
  retryFromStep?: NamedStep;
}

export interface WorkflowStepResult {
  name: string;
  state: WorkflowStepState;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  effects: string[];
  error?: TunnelError;
}

export function stepState(value: string): WorkflowStepState {
  const values: WorkflowStepState[] = ['pending', 'running', 'succeeded', 'warning', 'failed', 'skipped', 'cancelled'];
  if (!values.includes(value as WorkflowStepState)) throw new Error(`Unknown workflow step state: ${value}`);
  return value as WorkflowStepState;
}

export interface TunnelConfig {
  profile: Profile;
  operation: Operation;
  localUrl: string;
  projectRoot?: string;
  tunnelName?: string;
  hostname?: string;
  configPath?: string;
  laravel?: { mapAppUrl?: boolean; mapAssetUrl?: boolean; mapReverbUrl?: boolean };
}

export interface ValidationIssue { code: string; field?: string; reason: string; fix: string; }
export interface ValidationResult { ok: boolean; issues: ValidationIssue[]; normalized?: TunnelConfig; }
export interface FileOperation { path: string; action: 'create' | 'update'; content?: string; requiresConfirmation: boolean; }
export interface TunnelPlan {
  id: string; createdAt: string; config: TunnelConfig; valid: boolean;
  argv: string[]; fileOperations: FileOperation[]; confirmations: string[];
  issues: ValidationIssue[]; summary: string;
}
export interface ExecutionSummary { ok: boolean; operation: string; passed: string[]; skipped: string[]; issues: ValidationIssue[]; output?: string; }
