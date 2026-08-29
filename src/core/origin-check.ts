export interface OriginIssue { code: string; reason: string; fix: string; }
export type OriginCheckResult =
  | { reachable: true; status: number; warning?: OriginIssue }
  | { reachable: false; error: OriginIssue };

function issue(code: string, reason: string, fix: string): OriginIssue { return { code, reason, fix }; }

export async function checkOrigin(localUrl: string, options: { timeoutMs?: number; maxRedirects?: number; fetchImpl?: typeof fetch } = {}): Promise<OriginCheckResult> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = localUrl;
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const response = await fetchImpl(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        if (redirects === maxRedirects) return { reachable: false, error: issue('ORIGIN_REDIRECT_LOOP', 'The local origin exceeded the redirect limit.', 'Fix the local redirect configuration before creating the tunnel.') };
        current = new URL(response.headers.get('location')!, current).toString();
        continue;
      }
      if (response.status >= 400 && response.status < 500) return { reachable: true, status: response.status, warning: issue('ORIGIN_HTTP_CLIENT_ERROR', `The local origin responded with HTTP ${response.status}.`, 'The service is reachable; verify that the requested path is expected to return this status.') };
      if (response.status >= 500) return { reachable: true, status: response.status, warning: issue('ORIGIN_HTTP_SERVER_ERROR', `The local origin responded with HTTP ${response.status}.`, 'Fix the local application error or continue only if this response is expected.') };
      return { reachable: true, status: response.status };
    }
    return { reachable: false, error: issue('ORIGIN_REDIRECT_LOOP', 'The local origin exceeded the redirect limit.', 'Fix the local redirect configuration before creating the tunnel.') };
  } catch (error) {
    const message = error instanceof Error ? `${error.message} ${String((error as any).cause?.code ?? '')}` : String(error);
    if (/ECONNREFUSED|fetch failed/i.test(message)) return { reachable: false, error: issue('ORIGIN_CONNECTION_REFUSED', 'The local service refused the connection.', 'Start the local application and verify its host and port.') };
    if (/TimeoutError|timed out|AbortError/i.test(message)) return { reachable: false, error: issue('ORIGIN_TIMEOUT', 'The local service did not respond before the timeout.', 'Verify the local URL and that the application is responsive.') };
    if (/certificate|TLS|SSL/i.test(message)) return { reachable: false, error: issue('ORIGIN_TLS_INVALID', 'The local HTTPS certificate could not be verified.', 'Use a trusted local certificate or explicitly choose the advanced insecure-origin option.') };
    return { reachable: false, error: issue('ORIGIN_UNREACHABLE', 'The local service could not be reached.', 'Verify the local URL and inspect the application logs.') };
  }
}
