import type { ConnectorExit } from '../providers/process-supervisor.js';
import type { ActivityFeed } from '../app/activity.js';
import type { Logger } from './logger.js';

const BACKOFF_MS = [5_000, 15_000, 60_000, 120_000, 300_000];
const STABLE_RESET_MS = 10 * 60_000;

interface WatchdogDeps {
  onExit(listener: (exit: ConnectorExit) => void): () => void;
  projectIdForKey(key: string): string | undefined;
  projectName(projectId: string): string;
  start(projectId: string): Promise<any>;
  settings(): { autoRestartOnCrash: boolean; maxRestartAttempts: number; notifyOnDisconnect: boolean };
  feed: ActivityFeed;
  log: Logger;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
}

/** Restarts connectors that exit without being asked to, with growing delays and an attempt cap. */
export class ConnectorWatchdog {
  private readonly attempts = new Map<string, { count: number; last: number }>();
  private readonly timers = new Map<string, unknown>();
  private readonly unsubscribe: () => void;
  private stopped = false;

  constructor(private readonly deps: WatchdogDeps) { this.unsubscribe = deps.onExit(exit => this.handle(exit)); }

  dispose(): void { this.stopped = true; this.unsubscribe(); for (const handle of this.timers.values()) (this.deps.clearTimer ?? clearTimeout)(handle as any); this.timers.clear(); }

  private handle(exit: ConnectorExit): void {
    if (this.stopped || exit.expected) return;
    const projectId = this.deps.projectIdForKey(exit.key); if (!projectId) return;
    this.deps.log('warn', `Connector for ${this.deps.projectName(projectId)} exited unexpectedly (code ${exit.code}).`);
    this.failed(projectId);
  }

  private failed(projectId: string): void {
    const settings = this.deps.settings(); const name = this.deps.projectName(projectId); const now = (this.deps.now ?? Date.now)();
    const previous = this.attempts.get(projectId);
    const count = previous && now - previous.last < STABLE_RESET_MS ? previous.count : 0;
    if (!settings.autoRestartOnCrash) { this.deps.feed.push({ type: 'connector-failed', title: `${name} disconnected`, message: 'The connector stopped unexpectedly. Automatic restart is off.', projectId, notify: settings.notifyOnDisconnect }); return; }
    if (count >= settings.maxRestartAttempts) { this.deps.feed.push({ type: 'connector-gave-up', title: `${name} keeps disconnecting`, message: `Gave up after ${count} restart attempts. Check the project details.`, projectId, notify: settings.notifyOnDisconnect }); return; }
    const delay = BACKOFF_MS[Math.min(count, BACKOFF_MS.length - 1)];
    this.attempts.set(projectId, { count: count + 1, last: now });
    this.deps.feed.push({ type: 'connector-failed', title: `${name} disconnected`, message: `Restarting in ${Math.round(delay / 1000)}s (attempt ${count + 1} of ${settings.maxRestartAttempts}).`, projectId, notify: settings.notifyOnDisconnect && count === 0 });
    if (this.timers.has(projectId)) return;
    this.timers.set(projectId, (this.deps.setTimer ?? setTimeout)(async () => {
      this.timers.delete(projectId); if (this.stopped) return;
      try {
        const result = await this.deps.start(projectId);
        if (result?.state === 'failed') throw new Error(result.error?.reason ?? result.error?.summary ?? 'restart failed');
        this.deps.log('info', `Restarted connector for ${name}.`);
        this.deps.feed.push({ type: 'connector-restarted', title: `${name} reconnected`, message: 'The connector was restarted.', projectId, notify: false });
      } catch (error) {
        this.deps.log('error', `Restart for ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        this.failed(projectId);
      }
    }, delay));
  }
}
