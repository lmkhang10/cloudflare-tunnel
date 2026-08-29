# Guided Tunnel Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reliable English-only CLI and browser wizard that creates Quick or named Cloudflare Tunnels, persists per-machine project state in SQLite, supervises long-running connectors, and gives actionable recovery guidance.

**Architecture:** A presentation-independent workflow engine coordinates narrow adapters for `cloudflared`, process supervision, SQLite persistence, origin checks, Git safety, and browser launch. UI and CLI consume the same workflow events and actions; application state lives in the platform data directory and runtime truth is reconciled before display.

**Tech Stack:** TypeScript ESM on Node.js 20+, Node test runner, `better-sqlite3`, `node:http`, `node:child_process`, native filesystem/process APIs, HTML/CSS/JavaScript served on loopback.

---

## File structure

Create these focused modules rather than expanding the current one-line implementations:

```text
src/
  app/
    paths.ts                 platform application-data paths
    service.ts               composition root used by CLI and UI
  core/
    types.ts                 shared domain types
    errors.ts                stable error constructors and classifier contract
    validation.ts            pure input validation
    origin-check.ts          bounded local HTTP/HTTPS reachability checks
    workflow.ts              resumable workflow state machine
    quick-workflow.ts        Quick Tunnel steps
    named-workflow.ts        named-tunnel steps
    redact.ts                diagnostics redaction
  persistence/
    database.ts              SQLite open/migrate/transaction lifecycle
    migrations.ts            ordered schema migrations
    store.ts                 project/tunnel/workflow/session repositories
  providers/
    command-runner.ts        bounded short-lived subprocess execution
    cloudflared.ts           typed Cloudflare command adapter
    process-supervisor.ts    long-running connector lifecycle
    browser.ts               platform browser launcher
    git-safety.ts            tracked/staged/local-exclude checks
  cli/
    main.ts                  command parsing and composition
    wizard.ts                terminal wizard renderer/input loop
  ui/
    server.ts                loopback API and event transport
    page.ts                  English browser UI asset
tests/
  helpers/fake-cloudflared.js
  paths.test.js
  persistence.test.js
  cloudflared.test.js
  origin-validation.test.js
  process-supervisor.test.js
  quick-workflow.test.js
  named-workflow.test.js
  git-safety.test.js
  cli.test.js
  ui.test.js
```

Keep `src/index.ts` as the supported library export surface. Preserve existing MVP exports until a documented major release.

## Task 1: Establish domain contracts and English error taxonomy

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/errors.ts`
- Modify: `src/index.ts`
- Create: `tests/errors.test.js`

- [ ] **Step 1: Write failing tests for structured errors and workflow states**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tunnelError, stepState } from '../dist/index.js';

test('creates an actionable English error', () => {
  const error = tunnelError('DNS_PERMISSION_DENIED', {
    hostname: 'dev.example.com',
    completedEffects: ['Created tunnel shop-local (abc-123).'],
  });
  assert.equal(error.title, 'DNS permission denied');
  assert.match(error.summary, /dev\.example\.com/);
  assert.deepEqual(error.availableActions, ['sign-in-again', 'retry', 'copy-diagnostics']);
  assert.equal(error.retryFromStep, 'dns-route');
});

test('accepts only declared workflow states', () => {
  assert.equal(stepState('succeeded'), 'succeeded');
  assert.throws(() => stepState('done'), /Unknown workflow step state/);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm run build && node --test tests/errors.test.js`

Expected: FAIL because `tunnelError` and `stepState` are not exported.

- [ ] **Step 3: Replace loose result types with explicit contracts**

Define in `src/core/types.ts`:

```ts
export type TunnelKind = 'quick' | 'named';
export type WorkflowStepState =
  | 'pending' | 'running' | 'succeeded' | 'warning'
  | 'failed' | 'skipped' | 'cancelled';

export type NamedStep =
  | 'environment' | 'input' | 'origin' | 'filesystem' | 'git-safety'
  | 'authentication' | 'account-access' | 'tunnel' | 'configuration'
  | 'ingress-validation' | 'dns-route' | 'connector'
  | 'cloudflare-health' | 'public-health';

export type RecoveryAction =
  | 'retry' | 'sign-in-again' | 'change-input' | 'open-dashboard'
  | 'copy-diagnostics' | 'stop' | 'force-stop';

export interface TunnelError {
  code: string;
  title: string;
  summary: string;
  likelyCause: string;
  completedEffects: string[];
  remediationSteps: string[];
  availableActions: RecoveryAction[];
  safeDiagnostics?: Record<string, unknown>;
  retryFromStep?: NamedStep;
}

export interface WorkflowStepResult {
  name: string;
  state: WorkflowStepState;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  effects: string[];
  error?: TunnelError;
}

export function stepState(value: string): WorkflowStepState {
  const values: WorkflowStepState[] = [
    'pending', 'running', 'succeeded', 'warning', 'failed', 'skipped', 'cancelled',
  ];
  if (!values.includes(value as WorkflowStepState)) {
    throw new Error(`Unknown workflow step state: ${value}`);
  }
  return value as WorkflowStepState;
}
```

Implement `tunnelError` in `src/core/errors.ts` using an exhaustive registry. The `DNS_PERMISSION_DENIED` entry must exactly match the test and unknown stderr must map to `CLOUDFLARED_COMMAND_FAILED` with exit status and redacted stderr. Export the new contracts from `src/index.ts`.

- [ ] **Step 4: Verify GREEN and regression safety**

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 5: Commit the contracts**

```bash
git add src/core/types.ts src/core/errors.ts src/index.ts tests/errors.test.js
git commit -m "feat: define tunnel workflow contracts"
```

## Task 2: Add platform-local application paths

**Files:**
- Create: `src/app/paths.ts`
- Create: `tests/paths.test.js`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing cross-platform path tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveAppPaths } from '../dist/index.js';

test('uses Application Support on macOS', () => {
  const paths = resolveAppPaths({ platform: 'darwin', home: '/Users/alice', env: {} });
  assert.equal(paths.dataDir, '/Users/alice/Library/Application Support/cloudflare-tunnel-kit');
  assert.equal(paths.database, path.join(paths.dataDir, 'state.db'));
});

test('honors XDG_DATA_HOME on Linux', () => {
  const paths = resolveAppPaths({ platform: 'linux', home: '/home/alice', env: { XDG_DATA_HOME: '/data' } });
  assert.equal(paths.dataDir, '/data/cloudflare-tunnel-kit');
});

test('uses LOCALAPPDATA on Windows', () => {
  const paths = resolveAppPaths({ platform: 'win32', home: 'C:\\Users\\Alice', env: { LOCALAPPDATA: 'C:\\Local' } });
  assert.match(paths.dataDir, /Local.*cloudflare-tunnel-kit/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/paths.test.js`

Expected: FAIL because `resolveAppPaths` does not exist.

- [ ] **Step 3: Implement deterministic path resolution**

```ts
import path from 'node:path';

export interface AppPaths {
  dataDir: string;
  database: string;
  projectsDir: string;
  backupsDir: string;
}

export function resolveAppPaths(input: {
  platform?: NodeJS.Platform;
  home?: string;
  env?: Record<string, string | undefined>;
} = {}): AppPaths {
  const platform = input.platform ?? process.platform;
  const home = input.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  const env = input.env ?? process.env;
  if (!home && platform !== 'win32') throw new Error('Unable to determine the user home directory.');
  const root = platform === 'darwin'
    ? path.join(home, 'Library', 'Application Support')
    : platform === 'win32'
      ? (env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'))
      : (env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'));
  const dataDir = path.join(root, 'cloudflare-tunnel-kit');
  return {
    dataDir,
    database: path.join(dataDir, 'state.db'),
    projectsDir: path.join(dataDir, 'projects'),
    backupsDir: path.join(dataDir, 'backups'),
  };
}
```

Export it from `src/index.ts`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all tests PASS on the current platform; simulated platform tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/paths.ts src/index.ts tests/paths.test.js
git commit -m "feat: resolve per-user application paths"
```

## Task 3: Implement versioned SQLite persistence

**Files:**
- Create: `src/persistence/migrations.ts`
- Create: `src/persistence/database.ts`
- Create: `src/persistence/store.ts`
- Create: `tests/persistence.test.js`
- Modify: `src/index.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the Node 20-compatible SQLite dependency**

Run: `npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3`

Expected: `package.json` records `better-sqlite3` under dependencies and its type package under dev dependencies. This preserves the package's declared Node.js 20 minimum; do not use `node:sqlite`, which is unavailable in early Node.js 20 releases.

- [ ] **Step 2: Write failing persistence tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStateDatabase, StateStore } from '../dist/index.js';

test('persists a project and resumable workflow without secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cf-kit-db-'));
  const db = openStateDatabase(path.join(root, 'state.db'));
  const store = new StateStore(db);
  const project = store.saveProject({ displayName: 'Shop', path: '/work/shop', profile: 'custom' });
  const run = store.createWorkflow({ projectId: project.id, kind: 'named' });
  store.recordStep(run.id, { name: 'tunnel', state: 'succeeded', attempts: 1, effects: ['Created abc'], safeResult: {} });
  assert.equal(store.listProjects()[0].displayName, 'Shop');
  assert.equal(store.getWorkflow(run.id).steps[0].state, 'succeeded');
  assert.doesNotMatch(JSON.stringify(store.getWorkflow(run.id)), /private-key|bearer/i);
  db.close();
  await rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 3: Verify RED**

Run: `npm run build && node --test tests/persistence.test.js`

Expected: FAIL because persistence modules do not exist.

- [ ] **Step 4: Implement the initial migration**

In `src/persistence/migrations.ts`, export migration version `1` with SQL creating `schema_migrations`, `projects`, `tunnels`, `workflow_runs`, `workflow_steps`, `process_sessions`, `events`, and `installations`. Use `TEXT` UUID primary keys, ISO timestamp `TEXT`, foreign keys, unique tunnel UUID when present, and `UNIQUE(workflow_run_id, name)` for workflow steps. Do not create columns for certificate content, credential content, tokens, cookies, authorization headers, or unredacted stderr.

In `src/persistence/database.ts`:

```ts
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { migrations } from './migrations.js';

export function openStateDatabase(filename: string): Database.Database {
  mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  if (existsSync(filename)) copyFileSync(filename, `${filename}.pre-migration-backup`);
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as {version:number}[]).map(x => x.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
```

Implement `StateStore` with parameterized statements and `crypto.randomUUID()`. `recordStep` must upsert by run/name, increment attempts only when called with a new attempt, and accept only pre-redacted `safeResult`. JSON serialization must go through `redact` before storage.

- [ ] **Step 5: Verify GREEN and migration idempotency**

Add a second test that closes and reopens the same database and asserts migration `1` exists exactly once. Run: `npm test`.

Expected: all tests PASS and no database file appears in the repository.

- [ ] **Step 6: Commit**

```bash
git add src/persistence src/index.ts tests/persistence.test.js package.json package-lock.json
git commit -m "feat: persist local tunnel project state"
```

## Task 4: Build a typed short-command Cloudflare adapter

**Files:**
- Create: `src/providers/command-runner.ts`
- Rewrite: `src/providers/cloudflared.ts`
- Create: `tests/helpers/fake-cloudflared.js`
- Create: `tests/cloudflared.test.js`
- Modify: `src/core/errors.ts`

- [ ] **Step 1: Write a fake executable fixture and failing adapter tests**

The fake executable accepts the same argv shape and uses `FAKE_CLOUDFLARED_SCENARIO` to emit deterministic version, list, create, login, ingress validation, route DNS, info, and failure outputs. It records JSON argv to `FAKE_CLOUDFLARED_RECORD` using `appendFileSync` and never invokes a shell.

```js
test('creates a tunnel with argv and parses its UUID and credential path', async () => {
  const adapter = new CloudflaredAdapter({ executable: fakeExecutable, env: fakeEnv('create-success') });
  const result = await adapter.createTunnel('shop-local');
  assert.equal(result.ok, true);
  assert.equal(result.value.uuid, '11111111-1111-4111-8111-111111111111');
  assert.match(result.value.credentialsFile, /11111111.*\.json$/);
  assert.deepEqual(readRecordedArgv(), ['tunnel', 'create', 'shop-local']);
});

test('classifies revoked authentication', async () => {
  const adapter = new CloudflaredAdapter({ executable: fakeExecutable, env: fakeEnv('auth-stale') });
  const result = await adapter.listTunnels();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'AUTH_STALE');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/cloudflared.test.js`

Expected: FAIL because `CloudflaredAdapter` does not exist.

- [ ] **Step 3: Implement the command runner**

`runCommand` accepts `{ executable, args, env, cwd, timeoutMs, signal, maxOutputBytes }`. It calls `spawn` with `shell:false`, `stdio:['ignore','pipe','pipe']`, bounded output buffers, abort handling, and a timeout. It returns `{ exitCode, signal, stdout, stderr, timedOut }`. It must settle once even if both `error` and `close` fire.

- [ ] **Step 4: Implement typed Cloudflare operations**

`CloudflaredAdapter` exposes:

```ts
version(): Promise<Result<{ version: string }>>
login(): Promise<Result<{ completed: true }>>
listTunnels(): Promise<Result<TunnelObservation[]>>
createTunnel(name: string): Promise<Result<{ uuid: string; credentialsFile: string }>>
validateIngress(configPath: string): Promise<Result<{ valid: true }>>
routeDns(tunnel: string, hostname: string): Promise<Result<{ hostname: string }>>
info(tunnel: string): Promise<Result<{ connectorState: 'healthy'|'degraded'|'disconnected'|'unknown' }>>
```

Prefer supported JSON output flags where available. For commands without stable JSON, isolate parsing in named pure functions with fixture tests. Unknown output returns `CLOUDFLARED_OUTPUT_UNRECOGNIZED`; it must not guess a UUID or credentials path.

- [ ] **Step 5: Verify GREEN and command safety**

Run: `npm test`

Expected: all tests PASS; recorded argv contains literal hostile test values and proves no shell expansion occurred.

- [ ] **Step 6: Commit**

```bash
git add src/providers/command-runner.ts src/providers/cloudflared.ts src/core/errors.ts tests/helpers tests/cloudflared.test.js
git commit -m "feat: add typed cloudflared command adapter"
```

## Task 5: Strengthen input and origin validation

**Files:**
- Rewrite: `src/core/validation.ts`
- Create: `src/core/origin-check.ts`
- Create: `tests/origin-validation.test.js`
- Modify: `src/core/types.ts`

- [ ] **Step 1: Write failing validation tests**

Test rejection of localhost hostname as a public hostname, wildcard hostname, URL-shaped hostname, IP hostname, missing named hostname, unsafe tunnel names, and quick-only field leakage. Test hostname lowercasing and IDN conversion. Test origin outcomes for reachable 200, reachable 404 warning, connection refused, timeout, TLS certificate failure, redirect loop, and 500 warning.

```js
test('requires and normalizes a named public hostname', () => {
  const result = validateTunnelConfig({ profile: 'custom', operation: 'create', localUrl: 'http://127.0.0.1:8000', tunnelName: 'shop', hostname: 'DEV.Example.com' });
  assert.equal(result.ok, true);
  assert.equal(result.normalized.hostname, 'dev.example.com');
});

test('treats an HTTP 404 origin as reachable with a warning', async () => {
  const result = await checkOrigin(serverUrlReturning(404), { timeoutMs: 1000 });
  assert.equal(result.reachable, true);
  assert.equal(result.warning.code, 'ORIGIN_HTTP_CLIENT_ERROR');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/origin-validation.test.js`

Expected: FAIL on missing hostname requirement and missing origin checker.

- [ ] **Step 3: Implement pure normalization and bounded checks**

Use `domainToASCII` from `node:url`; reject failed conversion. Keep path containment validation only for user-selected project paths. Application-managed configs are validated against the application project directory instead of the source repository. `checkOrigin` uses `fetch` with `AbortSignal.timeout`, manual bounded redirects, no response-body buffering, and typed outcome mapping. TLS verification remains on by default.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all tests PASS without external network access.

- [ ] **Step 5: Commit**

```bash
git add src/core/validation.ts src/core/origin-check.ts src/core/types.ts tests/origin-validation.test.js
git commit -m "feat: validate tunnel inputs and origins"
```

## Task 6: Add Git safety and local excludes

**Files:**
- Create: `src/providers/git-safety.ts`
- Create: `tests/git-safety.test.js`

- [ ] **Step 1: Write failing tests in temporary Git repositories**

```js
test('warns when cert.pem is staged', async () => {
  const repo = await makeGitRepo();
  await writeFile(path.join(repo, 'cert.pem'), 'sensitive fixture');
  await git(repo, ['add', 'cert.pem']);
  const result = await inspectGitSafety(repo);
  assert.equal(result.issues[0].code, 'GIT_SENSITIVE_FILE_TRACKED');
});

test('adds one local exclude without touching .gitignore', async () => {
  const repo = await makeGitRepo();
  await applyLocalExclude(repo, '.cloudflare-tunnel-kit/');
  await applyLocalExclude(repo, '.cloudflare-tunnel-kit/');
  assert.equal((await readFile(path.join(repo, '.git/info/exclude'), 'utf8')).match(/\.cloudflare-tunnel-kit/g).length, 1);
  await assert.rejects(readFile(path.join(repo, '.gitignore')));
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/git-safety.test.js`

Expected: FAIL because Git safety functions do not exist.

- [ ] **Step 3: Implement read-only inspection and explicit local exclude**

Use `git -C <root> rev-parse --show-toplevel`, `git ls-files`, and `git diff --cached --name-only` through `runCommand`. Match exact `cert.pem`, tunnel UUID JSON patterns, private-key extensions, and application-generated config paths. Do not inspect secret file contents. `applyLocalExclude` resolves the real Git directory with `git rev-parse --git-path info/exclude`, previews the rule at the service layer, and writes atomically only after explicit confirmation.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all tests PASS and repository fixtures show no `.gitignore` mutation.

- [ ] **Step 5: Commit**

```bash
git add src/providers/git-safety.ts tests/git-safety.test.js
git commit -m "feat: detect Git credential risks"
```

## Task 7: Supervise long-running connector processes

**Files:**
- Create: `src/providers/process-supervisor.ts`
- Create: `tests/process-supervisor.test.js`
- Modify: `src/core/redact.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```js
test('returns after startup while the connector remains alive', async () => {
  const supervisor = new ProcessSupervisor();
  const session = await supervisor.start({ key: 'quick:shop', executable: fakeExecutable, args: ['tunnel', '--url', 'http://127.0.0.1:8000'], env: fakeEnv('quick-running') });
  assert.equal(session.state, 'running');
  assert.equal(supervisor.status('quick:shop').state, 'running');
  assert.match(await session.waitForOutput(/trycloudflare\.com/, 2000), /trycloudflare\.com/);
  await supervisor.stop('quick:shop');
  assert.equal(supervisor.status('quick:shop').state, 'stopped');
});

test('rejects a duplicate connector key', async () => {
  const supervisor = new ProcessSupervisor();
  await supervisor.start(connectorOptions('named:abc'));
  await assert.rejects(supervisor.start(connectorOptions('named:abc')), /already running/);
  await supervisor.stop('named:abc');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/process-supervisor.test.js`

Expected: FAIL because `ProcessSupervisor` does not exist.

- [ ] **Step 3: Implement the in-process supervisor**

Use a `Map<string, ManagedProcess>`. Start with `shell:false`, stream line events through `EventEmitter`, keep a ring buffer capped by byte count, redact before storage, and resolve startup after spawn rather than process exit. Stop sends `SIGTERM`, waits a bounded grace period, then returns a `force-stop` action without killing automatically. Store start time and executable/argv identity for reconciliation; never trust a persisted PID alone.

- [ ] **Step 4: Verify GREEN and no hanging tests**

Run: `npm test`

Expected: all tests PASS and Node exits cleanly with no orphan fixture process.

- [ ] **Step 5: Commit**

```bash
git add src/providers/process-supervisor.ts src/core/redact.ts tests/process-supervisor.test.js
git commit -m "feat: supervise long-running tunnel connectors"
```

## Task 8: Implement the resumable workflow engine and Quick Tunnel vertical slice

**Files:**
- Create: `src/core/workflow.ts`
- Create: `src/core/quick-workflow.ts`
- Create: `tests/quick-workflow.test.js`
- Modify: `src/persistence/store.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing Quick workflow tests**

Test the ordered step events, origin failure before process start, successful URL parsing, persistence, cancellation, and expiration after stop.

```js
test('starts and persists a Quick Tunnel without blocking for process exit', async () => {
  const harness = await quickHarness('quick-running');
  const result = await harness.workflow.run({ projectPath: harness.project, localUrl: harness.originUrl });
  assert.equal(result.state, 'succeeded');
  assert.match(result.publicUrl, /^https:\/\/[-a-z0-9]+\.trycloudflare\.com$/);
  assert.equal(harness.supervisor.status(result.sessionKey).state, 'running');
  assert.equal(harness.store.listProjects().length, 1);
  await harness.workflow.stop(result.projectId);
  assert.equal(harness.store.getLatestSession(result.projectId).ephemeralUrlExpired, true);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/quick-workflow.test.js`

Expected: FAIL because `QuickTunnelWorkflow` does not exist.

- [ ] **Step 3: Implement generic step execution**

`WorkflowRunner.runStep(name, operation)` records `running`, executes once under a run lock, records `succeeded`/`warning`/`failed`, redacts safe results, emits progress, and stops later steps after failure. It accepts a stored workflow and skips a succeeded step only after its `reconcile` callback confirms the effect still exists.

- [ ] **Step 4: Implement Quick Tunnel orchestration**

Run validation, origin check, and process startup. Parse only an HTTPS URL ending exactly in `.trycloudflare.com` from bounded redacted process output. If no URL appears before startup timeout, stop the connector and return `QUICK_URL_NOT_RECEIVED`. Save project/session only through `StateStore`; no generated file is written to the repository.

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: all tests PASS; Quick fixture remains running until explicit stop and no 120-second timeout is used.

- [ ] **Step 6: Commit**

```bash
git add src/core/workflow.ts src/core/quick-workflow.ts src/persistence/store.ts src/index.ts tests/quick-workflow.test.js
git commit -m "feat: add resumable Quick Tunnel workflow"
```

## Task 9: Implement named-tunnel setup and safe retry

**Files:**
- Create: `src/core/named-workflow.ts`
- Create: `tests/named-workflow.test.js`
- Modify: `src/providers/cloudflared.ts`
- Modify: `src/persistence/store.ts`

- [ ] **Step 1: Write failing happy-path and recovery tests**

```js
test('completes login, create, config, DNS, connector, and health in order', async () => {
  const harness = await namedHarness('named-success');
  const result = await harness.workflow.run(namedInput(harness));
  assert.equal(result.state, 'succeeded');
  assert.deepEqual(harness.completedSteps(), [
    'environment','input','origin','filesystem','git-safety','authentication',
    'account-access','tunnel','configuration','ingress-validation','dns-route',
    'connector','cloudflare-health','public-health',
  ]);
  assert.equal(result.publicUrl, 'https://dev.example.com');
});

test('retries DNS permission failure without creating another tunnel', async () => {
  const harness = await namedHarness('dns-denied-then-success');
  const first = await harness.workflow.run(namedInput(harness));
  assert.equal(first.error.code, 'DNS_PERMISSION_DENIED');
  const second = await harness.workflow.retry(first.runId);
  assert.equal(second.state, 'succeeded');
  assert.equal(harness.commandCount(['tunnel','create','shop-local']), 1);
  assert.equal(harness.commandCountPrefix(['tunnel','route','dns']), 2);
});
```

Also test stale authentication followed by login, existing matching tunnel adoption confirmation, tunnel-name conflict refusal, credentials missing, config conflict, ingress failure before DNS, DNS record conflict without overwrite, and failed public health reported as warning when the connector is healthy.

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/named-workflow.test.js`

Expected: FAIL because `NamedTunnelWorkflow` does not exist.

- [ ] **Step 3: Implement plan and confirmation boundary**

`prepare(input)` runs through account/tunnel observation and returns a serializable plan with local effects, Cloudflare effects, warnings, and a plan fingerprint. `execute(planId, confirmations)` reloads the plan, verifies its fingerprint and freshness, and refuses mutation when required confirmation groups are missing.

- [ ] **Step 4: Implement application-owned config generation**

Write YAML to `<projectsDir>/<projectId>/config.yml` atomically with mode `0o600`:

```yaml
tunnel: <uuid>
credentials-file: <absolute credential path>
ingress:
  - hostname: <hostname>
    service: <local URL>
  - service: http_status:404
```

Escape YAML scalar values safely. Store a SHA-256 fingerprint. Preview changes and back up only an existing application-owned config. Refuse a non-owned config path or content mismatch with `CONFIG_CONFLICT`.

- [ ] **Step 5: Implement authentication continuation and idempotent mutations**

Authentication first calls `listTunnels`. On `AUTH_REQUIRED` or `AUTH_STALE`, emit `authentication-required`, call the injected browser-capable login adapter, wait for exit, then call `listTunnels` again. Tunnel creation re-lists before create. DNS retry reuses the stored UUID. No failure path calls delete or force-delete.

- [ ] **Step 6: Verify GREEN**

Run: `npm test`

Expected: all tests PASS, denied DNS retry creates one tunnel, and no generated config appears under test project roots.

- [ ] **Step 7: Commit**

```bash
git add src/core/named-workflow.ts src/providers/cloudflared.ts src/persistence/store.ts tests/named-workflow.test.js
git commit -m "feat: orchestrate recoverable named tunnels"
```

## Task 10: Compose the application service and reconciliation dashboard model

**Files:**
- Create: `src/app/service.ts`
- Create: `tests/service.test.js`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing service tests**

Test that project listing reconciles a stale stored PID to `Stopped`, a missing project path to `Needs attention`, a live supervised connector to `Running`, and a partially failed workflow to `Setup incomplete`.

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/service.test.js`

Expected: FAIL because `TunnelKitService` does not exist.

- [ ] **Step 3: Implement one composition root**

`createTunnelKitService(options)` resolves paths, opens SQLite, creates `StateStore`, `CloudflaredAdapter`, `ProcessSupervisor`, `QuickTunnelWorkflow`, and `NamedTunnelWorkflow`. Tests inject every external dependency. Expose:

```ts
listProjects(): Promise<ProjectSummary[]>
getProject(id: string): Promise<ProjectDetail>
prepareQuick(input: QuickInput): Promise<WorkflowPlan>
prepareNamed(input: NamedInput): Promise<WorkflowPlan>
execute(planId: string, confirmations: string[]): Promise<WorkflowResult>
retry(runId: string): Promise<WorkflowResult>
start(projectId: string): Promise<WorkflowResult>
stop(projectId: string): Promise<WorkflowResult>
restart(projectId: string): Promise<WorkflowResult>
doctor(): Promise<DoctorReport>
removeLocal(projectId: string): Promise<void>
```

`listProjects` reconciles before deriving display state and never reports `Running` from SQLite alone.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/service.ts src/index.ts tests/service.test.js
git commit -m "feat: compose local tunnel management service"
```

## Task 11: Replace the terminal CLI with a shared step wizard

**Files:**
- Rewrite: `src/cli/main.ts`
- Rewrite: `src/cli/wizard.ts`
- Create: `tests/cli.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI tests**

Spawn the built CLI with a temporary app-data directory and fake Cloudflare executable. Test:

- `cf-tunnel` shows the four English choices.
- `cf-tunnel quick` prompts only for missing Quick fields.
- `cf-tunnel create --url ...` asks for name and hostname.
- non-TTY missing input returns `INTERACTIVE_INPUT_REQUIRED` and a complete example.
- `--json` emits valid newline-delimited JSON without ANSI codes.
- cancellation saves a draft and exits with code `130`.

```js
assert.match(output, /Create a Quick Tunnel/);
assert.match(output, /Set up a custom domain/);
assert.match(output, /Open a saved project/);
assert.match(output, /Check system requirements/);
assert.doesNotMatch(output, /[À-ỹ]/);
```

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/cli.test.js`

Expected: FAIL because the current wizard does not expose the approved flow.

- [ ] **Step 3: Implement command parsing and wizard screens**

Use `node:readline/promises`; keep one question per screen. Render workflow events with ASCII symbols plus words so color is optional. The CLI calls only `TunnelKitService`. Direct commands and wizard selections must build the same input objects. Review output names local file and Cloudflare effects before invoking `execute`.

- [ ] **Step 4: Implement lifecycle and doctor commands**

`start`, `stop`, `restart`, `status`, and `doctor` select by project ID, tunnel UUID, tunnel name, or interactive saved-project choice. Ambiguous selectors produce an English list and no mutation. `doctor` reports Node, `cloudflared`, app-data write access, database migration, login status, origin when supplied, and Git safety.

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: all CLI snapshots are English and all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/main.ts src/cli/wizard.ts tests/cli.test.js package.json
git commit -m "feat: add guided terminal tunnel wizard"
```

## Task 12: Build the browser dashboard and live wizard

**Files:**
- Rewrite: `src/ui/server.ts`
- Create: `src/ui/page.ts`
- Create: `tests/ui.test.js`
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Write failing UI server tests**

Start on port `0` and test:

- `/` renders English project dashboard content.
- `/api/projects` returns reconciled summaries.
- plan and execute are separate requests.
- execute requires valid same-session token and JSON content type.
- oversized request body returns `413`.
- progress event stream emits step updates and supports reconnect with last event ID.
- a Quick execute request returns after connector startup rather than connector exit.
- closing the browser connection does not stop the connector.
- bind errors are caught and converted to `UI_BIND_FAILED`.

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/ui.test.js`

Expected: FAIL because the current one-page server has no project API, progress events, or service injection.

- [ ] **Step 3: Implement a service-injected loopback server**

`createUiServer({ service, sessionToken, maxBodyBytes: 64 * 1024 })` handles explicit routes, rejects non-loopback host headers, validates Origin for mutations, uses constant-time token comparison, and never accepts a credentials value. `listenUi` attaches an `error` listener before calling `listen`, prints the selected URL in its callback, and invokes the browser adapter unless `--no-open` is present.

- [ ] **Step 4: Implement the English browser experience**

`page.ts` exports static HTML/CSS/JS with no external CDN dependencies. It renders project cards, setup choices, one-step-at-a-time forms, review plan, live progress, recovery actions, project details, three-layer health, redacted logs, and explicit local removal versus Cloudflare deletion. Use semantic labels, keyboard focus, text status in addition to color, and responsive layout.

- [ ] **Step 5: Verify GREEN and manual visual behavior**

Run: `npm test`

Then run: `node dist/cli/main.js ui --no-open`

Expected: terminal immediately prints `UI ready at http://127.0.0.1:<port>`; opening that URL shows the project dashboard. Complete a fake Quick flow and confirm the page updates while the connector remains running.

- [ ] **Step 6: Commit**

```bash
git add src/ui/server.ts src/ui/page.ts src/cli/main.ts tests/ui.test.js
git commit -m "feat: add local tunnel management dashboard"
```

## Task 13: Add safe project editing, local removal, and explicit cleanup planning

**Files:**
- Modify: `src/app/service.ts`
- Modify: `src/core/named-workflow.ts`
- Modify: `src/ui/page.ts`
- Modify: `src/cli/wizard.ts`
- Create: `tests/project-management.test.js`

- [ ] **Step 1: Write failing project-management tests**

Test editing local URL creates a preview and re-validates before config update; relinking a missing project path; removing a local dashboard record without invoking Cloudflare; clearing logs without deleting project state; and generating a deletion plan that lists tunnel UUID, hostname/DNS consequence, and application-owned local files.

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/project-management.test.js`

Expected: FAIL because edit/relink/removal APIs do not exist.

- [ ] **Step 3: Implement non-destructive management actions**

Add `prepareEdit`, `executeEdit`, `relinkProject`, `clearLogs`, and `removeLocal`. `removeLocal` refuses while a managed connector is running unless it is stopped first. It deletes database records and optionally application-owned generated files only after distinct confirmations. It never invokes tunnel or DNS deletion.

- [ ] **Step 4: Implement cleanup as plan-only in this release**

Expose `prepareCloudflareCleanup(projectId)` that observes and displays exact resources but returns `CLOUDFLARE_CLEANUP_NOT_ENABLED` on execute. This avoids an ambiguous or insufficiently tested destructive feature while still telling users what exists and linking official manual cleanup guidance. Do not call `cloudflared tunnel delete` in this release.

- [ ] **Step 5: Verify GREEN**

Run: `npm test`

Expected: all tests PASS and fake command history contains no delete command.

- [ ] **Step 6: Commit**

```bash
git add src/app/service.ts src/core/named-workflow.ts src/ui/page.ts src/cli/wizard.ts tests/project-management.test.js
git commit -m "feat: manage saved tunnel projects safely"
```

## Task 14: Security, privacy, and bounded diagnostics audit

**Files:**
- Modify: `src/core/redact.ts`
- Modify: `src/persistence/store.ts`
- Modify: `src/ui/server.ts`
- Create: `tests/security.test.js`

- [ ] **Step 1: Write failing adversarial tests**

Cover bearer tokens, authorization headers, query tokens, PEM blocks, UUID credential paths, cookie values, secret environment keys, oversized output, symlink config targets, hostile host headers, cross-origin mutation requests, reused session tokens, and SQLite diagnostic content.

```js
test('never stores PEM or bearer content', () => {
  const value = redact('Authorization: Bearer abc123\n-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----');
  assert.doesNotMatch(value, /abc123|secret/);
  assert.match(value, /\[REDACTED\]/);
});
```

- [ ] **Step 2: Verify RED against at least one uncovered case**

Run: `npm run build && node --test tests/security.test.js`

Expected: FAIL on a redaction or request-boundary case not handled by the current implementation.

- [ ] **Step 3: Close only the demonstrated security gaps**

Apply redaction before logs/events reach persistence, enforce `lstat`/realpath containment before writes, cap diagnostics and logs by bytes, rotate UI session tokens per server start, and reject request bodies that include forbidden keys such as `token`, `certificate`, `credentialsContent`, or `privateKey`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test`

Expected: all adversarial and regression tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/redact.ts src/persistence/store.ts src/ui/server.ts tests/security.test.js
git commit -m "security: harden local tunnel state boundaries"
```

## Task 15: Documentation, package verification, and release readiness

**Files:**
- Rewrite: `README.md`
- Create: `docs/troubleshooting.md`
- Modify: `package.json`
- Modify: `src/cli/main.ts`
- Modify: `tests/core.test.js`

- [ ] **Step 1: Write failing documentation/CLI consistency tests**

Test that CLI `--help` and package version use `package.json`, documented commands appear in help, all README commands parse, `README.md` contains Quick versus named domain requirements, and English-only source scans exclude fixtures and historical superseded specs.

- [ ] **Step 2: Verify RED**

Run: `npm run build && node --test tests/core.test.js`

Expected: FAIL because CLI help currently hard-codes version `0.1.0` while package version differs.

- [ ] **Step 3: Update English documentation**

Document:

- `npx cf-tunnel` and `npx cf-tunnel ui` first.
- Quick Tunnel requires no login and gives an ephemeral URL.
- Named Tunnel requires an existing Cloudflare-managed domain and browser login.
- Per-user SQLite/config locations on each OS.
- No state sync between machines.
- Start/stop/status/retry/edit/remove semantics.
- Account certificate and credential-file sensitivity.
- Public exposure warning and Cloudflare Access guidance.
- Git-local exclusion behavior.
- Troubleshooting by stable error code.
- Uninstall and local-state cleanup as separate explicit instructions.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm test
npm run build
git diff --check
npm pack --dry-run
```

Expected:

- Every test PASS.
- TypeScript build exits `0`.
- `git diff --check` emits no output.
- Package contains `dist`, `README.md`, and `LICENSE`; it does not contain SQLite files, generated project configs, logs, test secrets, or application-data directories.

- [ ] **Step 5: Run manual acceptance with fake Cloudflare**

Run both entrypoints from a temporary consumer project:

```bash
npm install /absolute/path/to/cloudflare-tunnel-kit-package.tgz
npx cf-tunnel
npx cf-tunnel ui
```

Verify the terminal and browser complete Quick and named fake workflows, Resume survives UI restart, DNS denial Retry creates no duplicate tunnel, and generated state remains outside the temporary Git repository.

- [ ] **Step 6: Commit release-ready documentation**

```bash
git add README.md docs/troubleshooting.md package.json src/cli/main.ts tests/core.test.js
git commit -m "docs: document guided tunnel management"
```

## Final review checkpoint

- [ ] Compare every requirement in `docs/superpowers/specs/2026-08-29-guided-tunnel-management-design.md` to a completed task above.
- [ ] Search `src`, `tests`, `README.md`, and `docs/troubleshooting.md` for unfinished placeholder markers and the obsolete generic `PROCESS_FAILED` code; resolve every product-facing occurrence.
- [ ] Run `rg -n "cert\.pem|credentials-file|Authorization|Bearer" src tests` and inspect each match for safe handling.
- [ ] Run `git status --short` and confirm no SQLite, config, credential, log, backup, or temporary file is present.
- [ ] Run `npm test && npm run build && git diff --check && npm pack --dry-run` once more and retain the output for completion reporting.
