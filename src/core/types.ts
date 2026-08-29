export type Profile = 'custom' | 'laravel';
export type Operation = 'quick' | 'create' | 'start' | 'stop' | 'status';

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
