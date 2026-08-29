# Cloudflare Tunnel Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small TypeScript package that exposes a safe Cloudflare Tunnel library, text-only CLI wizard, loopback live UI, custom/Laravel adapters, and complete README documentation.

**Architecture:** Keep a dependency-light core for schemas, validation, redaction, plans, and errors. Put cloudflared process execution behind a provider, project-specific behavior behind adapters, and expose the same plan/summary model through CLI and a local HTTP UI. All mutations require an inspectable plan and explicit confirmation.

**Tech Stack:** Node.js 20+, TypeScript, `node:test`, built-in `http`/`child_process`/`fs` APIs, minimal browser JavaScript/CSS, npm package with a `cf-tunnel` bin.

---

### Task 1: Package foundation and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `src/index.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing package smoke test**

Create a test that imports the public entry point and asserts the package exposes `validateTunnelConfig`, `createTunnelPlan`, and `executeTunnelPlan`.

- [ ] **Step 2: Run the test to verify it fails**

Run `npm test`; expect module/import failure because the package has no implementation.

- [ ] **Step 3: Add package metadata and TypeScript build scripts**

Set package name `cloudflare-tunnel-kit`, version `0.1.0`, `type: module`, `build`, `test`, and `dev` scripts. Configure `dist/index.js` exports and `dist/cli/main.js` bin. Use compiler settings that emit ES2022 modules and declarations.

- [ ] **Step 4: Add the minimal public entry point**

Export placeholder typed functions from `src/index.ts`, then replace placeholders as later tasks land.

- [ ] **Step 5: Run the smoke test and build**

Run `npm test && npm run build`; expect PASS and generated `dist/`.

- [ ] **Step 6: Commit foundation**

Run `git add package.json tsconfig.json .gitignore src tests && git commit -m "chore: initialize tunnel kit package"` when repository write permissions are available.

### Task 2: Core config, errors, redaction, and validation (TDD)

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/errors.ts`
- Create: `src/core/redact.ts`
- Create: `src/core/validation.ts`
- Test: `tests/core/validation.test.ts`
- Test: `tests/core/redact.test.ts`

- [ ] **Step 1: Write tests for accepted and rejected configs**

Cover valid `custom` and `laravel` profiles, malformed URL, unsupported protocol, invalid hostname, invalid tunnel name, non-project config path, and missing required local URL. Assert stable error codes, field names, reason, and remediation.

- [ ] **Step 2: Run focused tests and verify failure**

Run `node --test --import tsx tests/core/validation.test.ts tests/core/redact.test.ts`; expect missing-module failures.

- [ ] **Step 3: Implement types and structured errors**

Define `TunnelConfig`, `ProjectContext`, `ValidationIssue`, `ValidationResult`, `TunnelOperation`, `LaravelMapping`, and `SafeError`. Keep secret values out of these public diagnostic types.

- [ ] **Step 4: Implement normalization and validation**

Normalize trailing slashes and default ports, validate `http`/`https`, DNS-safe hostnames, names `[a-z0-9][a-z0-9-]{0,62}`, and resolve paths under a project root without symlink escape.

- [ ] **Step 5: Implement redaction and AI prompt serialization**

Redact known secret keys and secret-looking values, certificate/token paths, bearer strings, and process output. Generate a copyable prompt containing only error code, safe context, and remediation.

- [ ] **Step 6: Run tests and build**

Run `npm test && npm run build`; expect all core tests to pass.

### Task 3: Plan generation and safe file operations (TDD)

**Files:**
- Create: `src/core/plan.ts`
- Create: `src/core/files.ts`
- Test: `tests/core/plan.test.ts`
- Test: `tests/core/files.test.ts`

- [ ] **Step 1: Test dry-run plan output**

Assert a plan contains only argv arrays, redacted file operations, validation timestamp/hash, and separate confirmation groups. Assert existing config produces a refusal unless overwrite is explicitly confirmed.

- [ ] **Step 2: Test path containment and backup behavior**

Use temporary project roots to verify allowed files, rejected `../` paths, symlink escapes, no overwrite by default, and backup creation before approved updates.

- [ ] **Step 3: Implement plan model and planner**

Implement `createTunnelPlan` returning a serializable plan with `checks`, `commands`, `fileOperations`, `confirmations`, and `redactedSummary`. Refuse stale or invalid plans at execution boundary.

- [ ] **Step 4: Implement guarded file operations**

Use `fs.promises`, exclusive creation by default, explicit UTF-8 writes, backup naming, and a final root containment check immediately before writing.

- [ ] **Step 5: Run focused tests**

Run `npm test`; expect plan and filesystem tests to pass without touching a user project.

### Task 4: cloudflared provider and lifecycle execution (TDD)

**Files:**
- Create: `src/providers/cloudflared.ts`
- Create: `src/core/execution.ts`
- Test: `tests/providers/cloudflared.test.ts`
- Test: `tests/core/execution.test.ts`

- [ ] **Step 1: Write fake-executable tests**

Verify `which/version`, quick tunnel, named tunnel, start, stop, and status use argv arrays; user input containing shell metacharacters remains one argv value. Test timeout, cancellation, non-zero exit, and redacted output.

- [ ] **Step 2: Implement provider**

Wrap `spawn` with explicit executable and argv, environment allowlist, timeout, signal cleanup, and structured process result. Never invoke a shell.

- [ ] **Step 3: Implement plan execution**

Require validation success, reject missing confirmation groups, run approved file operations and provider commands in order, and return passed/skipped/failed summary.

- [ ] **Step 4: Run provider tests**

Run `npm test`; expect process safety and lifecycle tests to pass.

### Task 5: Custom and Laravel adapters (TDD)

**Files:**
- Create: `src/adapters/custom.ts`
- Create: `src/adapters/laravel.ts`
- Test: `tests/adapters/custom.test.ts`
- Test: `tests/adapters/laravel.test.ts`

- [ ] **Step 1: Test custom adapter**

Assert a custom project accepts explicit local URL and optional hostname/name, with no framework assumptions.

- [ ] **Step 2: Test Laravel detection and mappings**

Use fixtures containing `artisan`, `composer.json`, and `.env` to assert detection, proposed `APP_URL`/`ASSET_URL`/optional Reverb mappings, redacted diff output, and refusal when `.env` is ambiguous or absent.

- [ ] **Step 3: Implement custom adapter**

Convert normalized custom input into a plan without implicit file mutations.

- [ ] **Step 4: Implement Laravel adapter**

Detect Laravel evidence, parse `.env` conservatively, generate explicit diff operations, mark each env mapping as `requiresConfirmation: true`, and expose `createLaravelPlan`.

- [ ] **Step 5: Run adapter tests**

Run `npm test`; expect all adapter tests to pass.

### Task 6: CLI wizard and commands (TDD)

**Files:**
- Create: `src/cli/main.ts`
- Create: `src/cli/wizard.ts`
- Create: `src/cli/render.ts`
- Test: `tests/cli/cli.test.ts`

- [ ] **Step 1: Test help, doctor, dry-run, and confirmation gates**

Assert `--help` lists commands, invalid input returns error code plus fix, `--dry-run` never launches cloudflared, and Laravel env operations cannot be bypassed by `--yes`.

- [ ] **Step 2: Implement command parser**

Support `init`, `create`, `quick`, `start`, `stop`, `status`, `doctor`, and `ui` with `--project-root`, `--config`, `--dry-run`, `--yes`, `--json`, and `--no-color`.

- [ ] **Step 3: Implement text wizard and summaries**

Ask one step at a time, render validation issues with code/reason/fix, render redacted plan, ask confirmations, and return non-zero exit codes by category.

- [ ] **Step 4: Run CLI tests and manual help check**

Run `npm test && npm run build && node dist/cli/main.js --help`; verify output is text-only and matches README examples.

### Task 7: Loopback live UI (TDD)

**Files:**
- Create: `src/ui/server.ts`
- Create: `src/ui/public/index.html`
- Create: `src/ui/public/app.js`
- Create: `src/ui/public/styles.css`
- Test: `tests/ui/server.test.ts`

- [ ] **Step 1: Test loopback binding and API**

Start the server on an ephemeral port, assert it binds to `127.0.0.1`, serves the wizard, validates input, returns redacted plan/error JSON, and rejects mutation without the ephemeral confirmation token.

- [ ] **Step 2: Implement static wizard shell**

Create a responsive seven-step UI with profile/operation controls, live validation, plan preview, confirmation checkboxes, result summary, and copy-AI-prompt button.

- [ ] **Step 3: Implement server endpoints**

Expose `GET /`, `GET /api/session`, `POST /api/validate`, `POST /api/plan`, and `POST /api/execute`; enforce same-origin and per-session mutation token checks.

- [ ] **Step 4: Run UI tests and smoke test**

Run `npm test`; then run `node dist/cli/main.js ui --no-open` and use a loopback request to confirm the HTML and dry-run flow.

### Task 8: README, examples, and final verification

**Files:**
- Modify: `README.md`
- Create: `examples/custom-config.json`
- Create: `examples/laravel-config.json`
- Create: `LICENSE`

- [ ] **Step 1: Document current version and design**

Explain the problem, idea, architecture, current `0.1.0` capabilities, non-goals, security model, supported profiles, and compatibility with the referenced Makefile flow.

- [ ] **Step 2: Document text-only installation and usage**

Include npm install, binary prerequisite, CLI wizard commands, dry-run, doctor, quick/named lifecycle, custom config, Laravel confirmation flow, UI launch, errors, troubleshooting, API usage, contribution, and release guidance. Do not rely on screenshots or visual-only instructions.

- [ ] **Step 3: Verify examples against CLI**

Run `npm run build`, `node dist/cli/main.js --help`, `node dist/cli/main.js doctor --dry-run`, and the documented custom/Laravel dry-run commands. Fix any mismatch.

- [ ] **Step 4: Run complete verification**

Run `npm test`, `npm run build`, `git diff --check`, and a loopback UI smoke test. Confirm no test writes outside temporary directories and no output contains fixture secrets.

- [ ] **Step 5: Report repository permission limitation**

If `.git` remains read-only, leave changes uncommitted and clearly list the exact commit commands for the repository owner; otherwise commit each completed task with focused messages.
