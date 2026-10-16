import net from 'node:net';

export interface OriginIssue { code: string; reason: string; fix: string; }
export type OriginCheckResult =
  | { reachable: true; status?: number; warning?: OriginIssue }
  | { reachable: false; error: OriginIssue };

function issue(code: string, reason: string, fix: string): OriginIssue { return { code, reason, fix }; }

/** Whether something accepts TCP connections at the URL's host and port. */
export function canConnect(url: string, timeoutMs: number): Promise<boolean> {
  const target = new URL(url);
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  return new Promise(resolve => {
    const socket = net.connect({ host: target.hostname.replace(/^\[|\]$/g, ''), port });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export async function checkOrigin(localUrl: string, options: { timeoutMs?: number; maxRedirects?: number; fetchImpl?: typeof fetch; connectImpl?: (url: string, timeoutMs: number) => Promise<boolean> } = {}): Promise<OriginCheckResult> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const fetchImpl = options.fetchImpl ?? fetch;
  const connectImpl = options.connectImpl ?? canConnect;
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
    const message = error instanceof Error ? `${error.name} ${error.message} ${String((error as any).cause?.code ?? '')}` : String(error);
    if (/TimeoutError|timed out|AbortError/i.test(message)) {
      // A slow first response (cold container, framework boot) should not block the tunnel when the port is open.
      if (await connectImpl(current, timeoutMs)) return { reachable: true, warning: issue('ORIGIN_SLOW', `The local service accepted the connection but did not respond within ${Math.round(timeoutMs / 1000)}s.`, 'The tunnel starts anyway; check the application if requests stay slow.') };
      return { reachable: false, error: issue('ORIGIN_TIMEOUT', 'The local service did not respond before the timeout.', 'Verify the local URL and that the application is responsive.') };
    }
    if (/ECONNREFUSED|fetch failed/i.test(message)) return { reachable: false, error: issue('ORIGIN_CONNECTION_REFUSED', 'The local service refused the connection.', 'Start the local application and verify its host and port.') };
    if (/certificate|TLS|SSL/i.test(message)) return { reachable: false, error: issue('ORIGIN_TLS_INVALID', 'The local HTTPS certificate could not be verified.', 'Use a trusted local certificate or explicitly choose the advanced insecure-origin option.') };
    return { reachable: false, error: issue('ORIGIN_UNREACHABLE', 'The local service could not be reached.', 'Verify the local URL and inspect the application logs.') };
  }
}
