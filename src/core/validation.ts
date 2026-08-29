import path from 'node:path';
import { realpathSync } from 'node:fs';
import type { TunnelConfig, ValidationIssue, ValidationResult } from './types.js';

function issue(code: string, reason: string, fix: string, field?: string): ValidationIssue { return { code, reason, fix, field }; }
function inside(root: string, candidate: string): boolean {
  try { const r = realpathSync(root); const c = realpathSync(path.dirname(candidate)); return c === r || c.startsWith(r + path.sep); } catch { return path.resolve(candidate).startsWith(path.resolve(root) + path.sep); }
}
export function validateTunnelConfig(input: TunnelConfig): ValidationResult {
  const issues: ValidationIssue[] = [];
  let url: URL | undefined;
  try { url = new URL(input.localUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { issues.push(issue('INPUT_INVALID_URL', 'localUrl must be an http or https URL.', 'Use a value such as http://127.0.0.1:8000.', 'localUrl')); }
  if (!['custom', 'laravel'].includes(input.profile)) issues.push(issue('INPUT_INVALID_PROFILE', 'Unknown project profile.', 'Choose custom or laravel.', 'profile'));
  if (input.operation === 'create' && !input.tunnelName) issues.push(issue('INPUT_TUNNEL_NAME_REQUIRED', 'Named tunnels require a tunnel name.', 'Use lowercase letters, numbers, and hyphens.', 'tunnelName'));
  if (input.tunnelName && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.tunnelName)) issues.push(issue('INPUT_INVALID_TUNNEL_NAME', 'Tunnel name is not DNS-safe.', 'Use 1-63 lowercase letters, numbers, or hyphens.', 'tunnelName'));
  if (input.hostname && !/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(input.hostname)) issues.push(issue('INPUT_INVALID_HOSTNAME', 'Hostname is not a valid DNS hostname.', 'Use a fully qualified hostname such as tunnel.example.com.', 'hostname'));
  const root = path.resolve(input.projectRoot ?? process.cwd());
  if (input.configPath && !inside(root, path.resolve(root, input.configPath))) issues.push(issue('PATH_OUTSIDE_PROJECT', 'Config path escapes the project root.', 'Choose a path inside projectRoot.', 'configPath'));
  const normalized = { ...input, localUrl: url?.toString().replace(/\/$/, '') ?? input.localUrl, projectRoot: root };
  return { ok: issues.length === 0, issues, normalized: issues.length === 0 ? normalized : undefined };
}
