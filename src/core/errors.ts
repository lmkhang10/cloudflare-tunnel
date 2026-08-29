import type { ValidationIssue } from './types.js';
export class TunnelKitError extends Error {
  constructor(public readonly issue: ValidationIssue) { super(`${issue.code}: ${issue.reason}`); this.name = 'TunnelKitError'; }
}
