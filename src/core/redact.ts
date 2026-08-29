import type { ValidationIssue } from './types.js';
const secretKey = /(token|secret|password|private|credential|key|cert)/i;
export function redact(value: string, key?: string): string {
  if (key && secretKey.test(key)) return '[REDACTED]';
  return value.replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]').replace(/([A-Za-z0-9_-]{24,})/g, '[REDACTED]');
}
export function redactValue(value: unknown, key?: string): unknown {
  if (key && secretKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redact(value, key);
  if (Array.isArray(value)) return value.map(item => redactValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey)]));
  }
  return value;
}
export function aiPrompt(issue: ValidationIssue): string {
  return `I am configuring cloudflare-tunnel-kit.\nError: ${issue.code}\nField: ${issue.field ?? 'environment'}\nReason: ${issue.reason}\nHow can I fix it? Do not expose secrets.`;
}
