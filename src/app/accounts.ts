import crypto from 'node:crypto';
import path from 'node:path';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import type { SavedAccount, StateStore } from '../persistence/store.js';
import { readCredentialsAccountTag, readOriginCertIdentity } from '../providers/origin-cert.js';
import type { TunnelError } from '../core/types.js';

export interface AccountPort {
  listTunnels(): Promise<{ ok: true; value: unknown[] } | { ok: false; error: TunnelError }>;
  login(options: { home: string; onOutput?: (chunk: string) => void }): Promise<{ ok: true; value: unknown } | { ok: false; error: TunnelError }>;
}

export interface AccountCandidate { candidateId: string; fileName: string; suggestedLabel: string; accountTag?: string; alreadyImported: boolean; importedAccountId?: string; duplicateOf?: string; }
export interface LoginJob { id: string; state: 'running' | 'succeeded' | 'failed'; loginUrl?: string; accountId?: string; error?: TunnelError | { code: string; title: string; summary: string }; startedAt: string; finishedAt?: string; }

const CANDIDATE = /^cert\.pem(\.[A-Za-z0-9._-]{1,64})?$/;
const LOGIN_JOB_TTL_MS = 30 * 60_000;

/**
 * Cloudflare accounts are origin certificates copied into the app data directory, one per account.
 * The user's ~/.cloudflared directory is read for discovery but never modified.
 */
export class AccountService {
  private readonly jobs = new Map<string, LoginJob>();
  private readonly store: StateStore; private readonly accountsDir: string; private readonly cloudflaredHome: string;
  private readonly adapterFor: (certPath?: string) => AccountPort;

  constructor(options: { store: StateStore; accountsDir: string; cloudflaredHome: string; adapterFor: (certPath?: string) => AccountPort }) {
    this.store = options.store; this.accountsDir = options.accountsDir; this.cloudflaredHome = options.cloudflaredHome; this.adapterFor = options.adapterFor;
  }

  list(defaultAccountId?: string): Array<SavedAccount & { tunnelCount: number; isDefault: boolean; certMissing: boolean }> {
    return this.store.listAccounts().map(account => ({ ...account, tunnelCount: this.store.countTunnelsForAccount(account.id), isDefault: account.id === defaultAccountId, certMissing: !existsSync(account.certPath) }));
  }

  certPathFor(accountId?: string): string | undefined {
    if (!accountId) return undefined;
    return this.store.getAccount(accountId).certPath;
  }

  credentialsFileFor(accountId: string | undefined, tunnelName: string): string | undefined {
    if (!accountId) return undefined;
    return path.join(this.accountsDir, accountId, 'tunnels', `${tunnelName}-${crypto.randomUUID().slice(0, 8)}.json`);
  }

  discover(): AccountCandidate[] {
    let names: string[] = [];
    try { names = readdirSync(this.cloudflaredHome).filter(name => CANDIDATE.test(name)).sort(); } catch { return []; }
    const candidates: AccountCandidate[] = names.flatMap(fileName => {
      const file = path.join(this.cloudflaredHome, fileName);
      try { if (!statSync(file).isFile()) return []; } catch { return []; }
      const { accountTag } = readOriginCertIdentity(file);
      const imported = accountTag ? this.store.findAccountByTag(accountTag) : undefined;
      const suffix = fileName.slice('cert.pem'.length).replace(/^\./, '');
      return [{ candidateId: fileName, fileName, suggestedLabel: suffix || 'default', accountTag, alreadyImported: Boolean(imported), importedAccountId: imported?.id }];
    });
    // cert.pem is often a copy of a renamed cert.pem.<name>; the named file is the better label for that account.
    for (const candidate of candidates) {
      if (!candidate.accountTag) continue;
      const preferred = candidates.find(other => other.accountTag === candidate.accountTag && other.fileName !== 'cert.pem') ?? candidates.find(other => other.accountTag === candidate.accountTag)!;
      if (preferred !== candidate) candidate.duplicateOf = preferred.fileName;
    }
    return candidates;
  }

  /** `candidateId` must come from `discover()`; arbitrary paths are never accepted. */
  importCandidate(candidateId: string, label?: string): SavedAccount {
    const candidate = this.discover().find(item => item.candidateId === candidateId);
    if (!candidate) throw new Error('That certificate was not found in ~/.cloudflared. Refresh the list and try again.');
    if (candidate.importedAccountId) return this.store.getAccount(candidate.importedAccountId);
    const id = crypto.randomUUID();
    const certPath = this.storeCert(id, path.join(this.cloudflaredHome, candidate.fileName), 'copy');
    const account = this.store.saveAccount({ id, label: cleanLabel(label) ?? candidate.suggestedLabel, accountTag: candidate.accountTag, certPath, source: 'import' });
    this.assignLegacyTunnels();
    return account;
  }

  importAll(): SavedAccount[] { return this.discover().filter(item => !item.alreadyImported && !item.duplicateOf).map(item => this.importCandidate(item.candidateId)); }

  /**
   * Runs `cloudflared tunnel login` with an isolated HOME so the new certificate never replaces ~/.cloudflared/cert.pem.
   * Pass `accountId` to refresh an existing account's certificate.
   */
  startLogin(options: { label?: string; accountId?: string } = {}): LoginJob {
    this.pruneJobs();
    if ([...this.jobs.values()].some(job => job.state === 'running')) throw new Error('A Cloudflare sign-in is already in progress. Finish it in the browser or wait for it to time out.');
    if (options.accountId) this.store.getAccount(options.accountId);
    const job: LoginJob = { id: crypto.randomUUID(), state: 'running', startedAt: new Date().toISOString() };
    this.jobs.set(job.id, job);
    void this.runLogin(job, options);
    return { ...job };
  }

  getLogin(jobId: string): LoginJob {
    const job = this.jobs.get(jobId); if (!job) throw new Error('Sign-in job not found or expired.');
    return { ...job };
  }

  async waitForLogin(jobId: string, pollMs = 250): Promise<LoginJob> {
    for (;;) { const job = this.getLogin(jobId); if (job.state !== 'running') return job; await new Promise(resolve => setTimeout(resolve, pollMs)); }
  }

  async verify(accountId: string): Promise<SavedAccount & { ok: boolean; error?: TunnelError; tunnelCount?: number }> {
    const account = this.store.getAccount(accountId);
    if (!existsSync(account.certPath)) {
      const saved = this.store.updateAccount(accountId, { status: 'missing' });
      return { ...saved, ok: false, error: { code: 'AUTH_REQUIRED', title: 'Certificate missing', summary: 'The saved certificate file for this account no longer exists.', likelyCause: 'The app data folder was edited.', completedEffects: [], remediationSteps: ['Sign in to this account again.'], availableActions: ['sign-in-again'] } };
    }
    const result = await this.adapterFor(account.certPath).listTunnels();
    if (result.ok) return { ...this.store.updateAccount(accountId, { status: 'ok', verified: true }), ok: true, tunnelCount: result.value.length };
    const status = ['AUTH_STALE', 'AUTH_REQUIRED'].includes(result.error.code) ? 'auth-failed' : 'error';
    return { ...this.store.updateAccount(accountId, { status }), ok: false, error: result.error };
  }

  rename(accountId: string, label: string): SavedAccount {
    const clean = cleanLabel(label); if (!clean) throw new Error('Account label must be 1 to 60 visible characters.');
    return this.store.updateAccount(accountId, { label: clean });
  }

  remove(accountId: string): void {
    const account = this.store.getAccount(accountId);
    const count = this.store.countTunnelsForAccount(accountId);
    if (count) throw new Error(`${count} saved tunnel(s) still use ${account.label}. Move or remove those projects first.`);
    this.store.removeAccount(accountId);
    const dir = path.join(this.accountsDir, accountId);
    if (path.dirname(dir) === this.accountsDir) rmSync(dir, { recursive: true, force: true });
  }

  /** Links tunnels created before multi-account support to an imported account via the AccountTag in their credentials. */
  assignLegacyTunnels(): number {
    let assigned = 0;
    for (const tunnel of this.store.listTunnels()) {
      if (tunnel.accountId || !tunnel.credentialsPath) continue;
      const tag = readCredentialsAccountTag(tunnel.credentialsPath);
      const account = tag ? this.store.findAccountByTag(tag) : undefined;
      if (account) { this.store.assignTunnelAccount(tunnel.id, account.id); assigned++; }
    }
    return assigned;
  }

  private async runLogin(job: LoginJob, options: { label?: string; accountId?: string }): Promise<void> {
    const home = path.join(this.accountsDir, `.login-${job.id}`);
    try {
      mkdirSync(home, { recursive: true, mode: 0o700 });
      const result = await this.adapterFor().login({ home, onOutput: chunk => { job.loginUrl ??= chunk.match(/https:\/\/dash\.cloudflare\.com\/argotunnel\S*/)?.[0]; } });
      if (!result.ok) throw Object.assign(new Error(result.error.summary), { tunnelError: result.error });
      const written = path.join(home, '.cloudflared', 'cert.pem');
      if (!existsSync(written)) throw new Error('cloudflared finished without writing a certificate.');
      const { accountTag } = readOriginCertIdentity(written);
      const target = options.accountId ? this.store.getAccount(options.accountId) : accountTag ? this.store.findAccountByTag(accountTag) : undefined;
      if (options.accountId && target?.accountTag && accountTag && target.accountTag !== accountTag) throw new Error(`You signed in to a different Cloudflare account than ${target.label}. Use "Add account" for a new account.`);
      const id = target?.id ?? crypto.randomUUID();
      const certPath = this.storeCert(id, written, 'move');
      const label = cleanLabel(options.label) ?? target?.label ?? `Account ${accountTag ? accountTag.slice(0, 6) : id.slice(0, 6)}`;
      const account = this.store.saveAccount({ id, label, accountTag: accountTag ?? target?.accountTag, certPath, source: target?.source ?? 'login' });
      this.assignLegacyTunnels();
      Object.assign(job, { state: 'succeeded', accountId: account.id, finishedAt: new Date().toISOString() });
    } catch (error) {
      const tunnelError = (error as any)?.tunnelError as TunnelError | undefined;
      Object.assign(job, { state: 'failed', error: tunnelError ?? { code: 'LOGIN_FAILED', title: 'Cloudflare sign-in failed', summary: error instanceof Error ? error.message : String(error) }, finishedAt: new Date().toISOString() });
    } finally { rmSync(home, { recursive: true, force: true }); }
  }

  private storeCert(accountId: string, source: string, mode: 'copy' | 'move'): string {
    const dir = path.join(this.accountsDir, accountId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, 'cert.pem'); const temporary = `${target}.tmp`;
    if (mode === 'copy') copyFileSync(source, temporary); else renameSync(source, temporary);
    chmodSync(temporary, 0o600); renameSync(temporary, target);
    return target;
  }

  private pruneJobs(): void {
    for (const [id, job] of this.jobs) if (job.finishedAt && Date.now() - Date.parse(job.finishedAt) > LOGIN_JOB_TTL_MS) this.jobs.delete(id);
  }
}

function cleanLabel(label?: string): string | undefined {
  const value = label?.replace(/[\u0000-\u001f]/g, '').trim();
  return value && value.length <= 60 ? value : undefined;
}
