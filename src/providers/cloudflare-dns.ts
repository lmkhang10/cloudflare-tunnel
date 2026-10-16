import { readOriginCertApiToken } from './origin-cert.js';

export interface DnsCleanupResult { state: 'deleted' | 'not-found' | 'skipped' | 'failed'; detail: string; }
export interface DnsCleanupPort { deleteTunnelRecord(hostname: string, tunnelUuid: string): Promise<DnsCleanupResult>; }

const API = 'https://api.cloudflare.com/client/v4';

/**
 * cloudflared can create DNS routes but cannot delete them, so cleanup talks to the Cloudflare API
 * with the token embedded in the account's origin certificate.
 * Only a CNAME that points at the given tunnel is deleted; any other record is left untouched.
 */
export class CloudflareDnsClient implements DnsCleanupPort {
  private readonly certPath?: string; private readonly fetch: typeof fetch; private readonly timeoutMs: number;

  constructor(options: { certPath?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.certPath = options.certPath; this.fetch = options.fetch ?? fetch; this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async deleteTunnelRecord(hostname: string, tunnelUuid: string): Promise<DnsCleanupResult> {
    const cert = this.certPath ? readOriginCertApiToken(this.certPath) : {};
    if (!cert.apiToken) return { state: 'skipped', detail: `The Cloudflare certificate has no API token, so the DNS record for ${hostname} was not deleted. Remove it in the Cloudflare dashboard.` };
    const target = `${tunnelUuid.toLowerCase()}.cfargotunnel.com`;
    let lastError = '';
    try {
      for (const zoneId of await this.zoneCandidates(cert.apiToken, hostname, cert.zoneId)) {
        const listed = await this.request(cert.apiToken, 'GET', `/zones/${zoneId}/dns_records?type=CNAME&name=${encodeURIComponent(hostname)}`);
        if (!listed.ok) { lastError = listed.error; continue; }
        const record = (listed.result as any[]).find(item => String(item?.name).toLowerCase() === hostname);
        if (!record) continue;
        if (String(record.content).toLowerCase() !== target) return { state: 'skipped', detail: `The DNS record for ${hostname} points to ${record.content}, not this tunnel, so it was left untouched.` };
        const removed = await this.request(cert.apiToken, 'DELETE', `/zones/${zoneId}/dns_records/${encodeURIComponent(record.id)}`);
        return removed.ok ? { state: 'deleted', detail: `Deleted the DNS record for ${hostname}.` } : { state: 'failed', detail: `Could not delete the DNS record for ${hostname}: ${removed.error}` };
      }
    } catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    return lastError ? { state: 'failed', detail: `Could not check the DNS record for ${hostname}: ${lastError}` } : { state: 'not-found', detail: `No DNS record for ${hostname} was found.` };
  }

  /** The certificate's own zone first, then any zone whose name is a suffix of the hostname. */
  private async zoneCandidates(token: string, hostname: string, certZone?: string): Promise<string[]> {
    const zones = certZone ? [certZone] : [];
    const labels = hostname.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const listed = await this.request(token, 'GET', `/zones?name=${encodeURIComponent(labels.slice(i).join('.'))}`);
      if (listed.ok) for (const zone of listed.result as any[]) if (zone?.id && !zones.includes(zone.id)) zones.push(zone.id);
    }
    return zones;
  }

  private async request(token: string, method: string, pathname: string): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
    const response = await this.fetch(`${API}${pathname}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(this.timeoutMs) });
    const body = await response.json().catch(() => ({})) as { success?: boolean; result?: unknown; errors?: Array<{ message?: string }> };
    if (response.ok && body.success !== false) return { ok: true, result: body.result ?? [] };
    return { ok: false, error: body.errors?.map(item => item.message).filter(Boolean).join('; ') || `HTTP ${response.status}` };
  }
}
