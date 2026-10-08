import { readFileSync } from 'node:fs';

export interface OriginCertIdentity { accountTag?: string; zoneId?: string; }

/**
 * Reads only the account identity from a cloudflared origin certificate.
 * The embedded API token is parsed in-place and never returned or logged.
 */
export function parseOriginCert(pem: string): OriginCertIdentity {
  const block = pem.match(/-----BEGIN ARGO TUNNEL TOKEN-----([\s\S]*?)-----END ARGO TUNNEL TOKEN-----/)?.[1];
  if (!block) return {};
  try {
    const decoded = JSON.parse(Buffer.from(block.replace(/\s+/g, ''), 'base64').toString('utf8')) as { accountID?: unknown; zoneID?: unknown };
    return {
      accountTag: typeof decoded.accountID === 'string' && /^[0-9a-f]{32}$/i.test(decoded.accountID) ? decoded.accountID : undefined,
      zoneId: typeof decoded.zoneID === 'string' && /^[0-9a-f]{32}$/i.test(decoded.zoneID) ? decoded.zoneID : undefined,
    };
  } catch { return {}; }
}

export function readOriginCertIdentity(file: string): OriginCertIdentity {
  try { return parseOriginCert(readFileSync(file, 'utf8')); } catch { return {}; }
}

/** Tunnel credential files carry the owning account tag next to the secret; only the tag is read. */
export function readCredentialsAccountTag(file: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as { AccountTag?: unknown };
    return typeof value.AccountTag === 'string' && /^[0-9a-f]{32}$/i.test(value.AccountTag) ? value.AccountTag : undefined;
  } catch { return undefined; }
}
