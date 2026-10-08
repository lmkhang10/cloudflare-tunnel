import { spawn } from 'node:child_process';
import { findDaemon, type DaemonInfo } from './lock.js';

export class DaemonClient {
  constructor(readonly info: DaemonInfo) {}

  async get(pathname: string): Promise<any> { return this.request('GET', pathname); }
  async post(pathname: string, body: unknown = {}): Promise<any> { return this.request('POST', pathname, body); }

  private async request(method: string, pathname: string, body?: unknown): Promise<any> {
    const response = await fetch(`${this.info.url}${pathname}`, {
      method, headers: { 'content-type': 'application/json', 'x-confirmation-token': this.info.token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json().catch(() => ({ error: 'Invalid response from the background service.' }));
    if (!response.ok) throw new Error(value.error ?? `Background service request failed (${response.status}).`);
    return value;
  }
}

/** The TunnelKitService surface used by the CLI and wizard, served by the background daemon. */
export function remoteService(client: DaemonClient): any {
  const project = (id: string, action: string) => client.post(`/api/projects/${encodeURIComponent(id)}/${action}`);
  return {
    remote: true,
    listProjects: async () => (await client.get('/api/projects')).projects,
    getProject: (id: string) => client.get(`/api/projects/${encodeURIComponent(id)}`),
    doctor: () => client.get('/api/doctor'),
    prepareQuick: (input: any) => client.post('/api/plans/quick', input),
    prepareNamed: (input: any) => client.post('/api/plans/named', input),
    execute: (planId: string, confirmations: string[]) => client.post('/api/execute', { planId, confirmations }),
    start: (id: string) => project(id, 'start'), stop: (id: string) => project(id, 'stop'),
    restart: (id: string) => project(id, 'restart'), retry: (id: string) => project(id, 'retry'), replaceDns: (id: string) => project(id, 'replace-dns'),
    close: () => undefined,
  };
}

export async function connectDaemon(dataDir: string): Promise<DaemonClient | undefined> {
  const info = await findDaemon(dataDir);
  return info ? new DaemonClient(info) : undefined;
}

/** Starts `cftunnel daemon run` detached from the terminal and waits until it answers. */
export async function spawnDaemon(options: { nodePath: string; cliPath: string; dataDir: string; args?: string[]; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<DaemonClient> {
  const child = spawn(options.nodePath, [options.cliPath, 'daemon', 'run', ...(options.args ?? [])], { detached: true, stdio: 'ignore', env: options.env ?? process.env });
  child.unref();
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const client = await connectDaemon(options.dataDir);
    if (client) return client;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('The background service did not start. Check the log in the app data folder (logs/daemon.log).');
}
