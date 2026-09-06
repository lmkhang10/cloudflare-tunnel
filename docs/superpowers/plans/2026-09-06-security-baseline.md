# Cloudflare Tunnel Kit Security Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the local tunnel manager against SSRF, unsafe filesystem inputs, HTTP boundary abuse, secret leakage, and incomplete child-process cleanup while keeping the existing CLI/UI workflow intact.

**Architecture:** Keep validation, HTTP security, filesystem policy, and process lifecycle as separate core/provider boundaries. All mutations remain plan/confirmation based; workflows must validate before creating Cloudflare resources and must persist safe recovery state after each external side effect. No secret content is stored or returned.

**Tech Stack:** TypeScript, Node.js built-in HTTP/child_process/fs APIs, better-sqlite3, Node test runner.

---

### Task 1: Establish a reproducible failing baseline

**Files:**
- Modify: `package.json`
- Test: `tests/security.test.js`, `tests/ui-dashboard.test.js`, `tests/process-supervisor.test.js`

- [ ] Record the current failure in `tests/named-workflow.test.js` and prevent test processes from hanging by adding a test timeout wrapper for subprocess tests.
- [ ] Add an npm script `test:unit` that runs the test suite without rebuilding, and keep `test` as build plus `test:unit`.
- [ ] Run `npm run build`, `npm run test:unit`, and `git diff --check`; record exact failures before changing behavior.
- [ ] Commit only the test-runner/baseline changes as `test: make security baseline reproducible`.

### Task 2: Add strict local-origin policy to prevent SSRF

**Files:**
- Modify: `src/core/validation.ts`, `src/core/origin-check.ts`, `src/core/types.ts`
- Test: `tests/origin-validation.test.js`, `tests/core.test.js`

- [ ] Define a default policy that accepts loopback/private development hosts only, rejects link-local and cloud metadata addresses, rejects credentials in URLs, rejects non-default ports outside the explicit advanced option, and rejects public IPs unless explicitly enabled.
- [ ] Resolve hostnames before allowing non-loopback hosts; reject DNS results that resolve to private, link-local, multicast, or metadata ranges to prevent DNS rebinding.
- [ ] Add an explicit `allowPrivateNetwork`/`allowPublicOrigin` decision to the validated config and require a separate confirmation group for it; do not infer it from the URL.
- [ ] Make origin checks use bounded redirect handling and revalidate every redirect target against the same policy.
- [ ] Add tests for `127.0.0.1`, `localhost`, IPv6 loopback, `169.254.169.254`, private IPv4, public URL, URL credentials, redirect-to-private, and DNS failure.
- [ ] Commit as `fix: enforce safe tunnel origin policy`.

### Task 3: Harden project and config paths

**Files:**
- Modify: `src/core/validation.ts`, `src/app/service.ts`, `src/core/named-workflow.ts`, `src/app/paths.ts`
- Test: `tests/paths.test.js`, `tests/project-management.test.js`, `tests/named-workflow.test.js`

- [ ] Canonicalize project paths with `realpath`, require an existing directory for relink and workflow execution, and reject symlink escapes.
- [ ] Validate `relinkProject` through the same path policy before writing SQLite state; reject duplicate project paths.
- [ ] Ensure generated config and credential paths remain under the application data directory, not the repository or an arbitrary path parsed from command output.
- [ ] Create data directories with `0700`, database files with restricted permissions, and verify existing files are not made more permissive.
- [ ] Use a unique temporary config file, flush/close it, then rename atomically; remove only the exact temporary file on failure.
- [ ] Add tests for traversal, symlink escape, nonexistent directory, duplicate relink, arbitrary credential output, and file modes.
- [ ] Commit as `fix: constrain project and tunnel file paths`.

### Task 4: Secure the local HTTP API

**Files:**
- Modify: `src/ui/server.ts`, `src/cli/main.ts`
- Test: `tests/ui-dashboard.test.js`, `tests/security.test.js`

- [ ] Bind only to loopback and reject requests with missing or invalid `Host` rather than accepting an empty header.
- [ ] Require an exact loopback `Origin` for browser mutations; reject cross-origin and malformed origins, and issue a short-lived per-server token that is not returned to non-loopback hosts.
- [ ] Add `Cache-Control: no-store`, `Content-Security-Policy` without `unsafe-inline`, `X-Frame-Options: DENY`, `Permissions-Policy`, and `Referrer-Policy` headers.
- [ ] Move dashboard JavaScript and CSS into safe static resources or attach a nonce to the generated inline blocks; ensure user data remains escaped.
- [ ] Validate route IDs and request JSON schemas before calling service methods; return stable public error objects without raw exception messages, paths, stderr, or stack traces.
- [ ] Add method/path allowlisting, request size enforcement that drains/handles oversized bodies cleanly, and a small per-session mutation rate limit.
- [ ] Add tests for missing Host, invalid Host, cross-origin POST, replayed token, invalid JSON shape, oversized body, secret-shaped fields, security headers, and escaped UI output.
- [ ] Commit as `fix: harden local dashboard API boundary`.

### Task 5: Make secret handling explicit and verifiable

**Files:**
- Modify: `src/core/redact.ts`, `src/providers/cloudflared.ts`, `src/providers/command-runner.ts`, `src/persistence/store.ts`
- Test: `tests/security.test.js`, `tests/cloudflared.test.js`, `tests/persistence.test.js`

- [ ] Redact PEM blocks, bearer/API tokens, query parameters, credential paths, and secret-shaped object keys before persistence, logs, diagnostics, HTTP responses, and generated AI prompts.
- [ ] Replace generic key matching that can over-redact benign fields with an explicit sensitive-key set plus value-pattern redaction.
- [ ] Bound stdout/stderr by bytes without accidentally splitting UTF-8 into invalid output, and redact before storing the bounded result.
- [ ] Ensure command failures expose stable error codes and safe remediation only; preserve raw output only in memory for classification.
- [ ] Add regression fixtures proving no credential content survives database rows, workflow step results, HTTP errors, or test snapshots.
- [ ] Commit as `fix: make secret redaction boundary explicit`.

### Task 6: Close process lifecycle and recovery gaps

**Files:**
- Modify: `src/providers/process-supervisor.ts`, `src/app/service.ts`, `src/core/quick-workflow.ts`, `src/core/named-workflow.ts`, `src/persistence/store.ts`
- Test: `tests/process-supervisor.test.js`, `tests/service.test.js`, `tests/quick-workflow.test.js`, `tests/named-workflow.test.js`

- [ ] Track process groups where supported and escalate from SIGTERM to SIGKILL after the grace period; always resolve stop with an accurate final state.
- [ ] Handle abort signals, spawn errors, and early child exit without leaving a running session in SQLite.
- [ ] On service startup, reconcile persisted sessions using PID identity checks and mark stale sessions stopped/failed; never signal a reused PID without identity verification.
- [ ] Make repeated start/retry idempotent and prevent duplicate Quick Tunnel projects for the same normalized project path unless explicitly requested.
- [ ] Persist workflow progress after every external side effect and return a resumable error state for DNS/config/connector failures.
- [ ] Add tests for early exit, timeout escalation, abort, stale PID, duplicate start, restart after process loss, and partial named-tunnel failure.
- [ ] Commit as `fix: make connector lifecycle recoverable`.

### Task 7: Verify the baseline and update security documentation

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-08-29-guided-tunnel-management-design.md`
- Test: `.github/workflows/ci.yml` if present, `tests/*.test.js`

- [ ] Run `npm run build`, `npm run test:unit`, `npm test`, `git diff --check`, and `npm pack --dry-run` with an isolated writable npm cache if the global cache remains permission-blocked.
- [ ] Add CI checks for build, tests, diff whitespace, package contents, and a consumer install/import smoke test.
- [ ] Document the origin trust model, advanced network opt-in, token scope, local data permissions, recovery behavior, and known Cloudflare account limitations.
- [ ] Run a final repository search for secret-shaped fields, unsafe shell execution, unrestricted paths, and raw exception responses.
- [ ] Commit as `docs: document security baseline and verification`.

## Completion Criteria

- All tests pass without hanging, including the previously failing named-workflow test.
- Default origin policy cannot expose metadata, link-local, private, or arbitrary public services without an explicit reviewed option.
- No HTTP response, SQLite row, workflow result, log, or diagnostic contains secret content or raw internal exception details.
- Project/config paths are canonicalized and constrained; generated sensitive files have restrictive permissions.
- Connector stop/restart/startup recovery is deterministic and tested.
- Build, test, package, whitespace, and consumer checks have fresh recorded evidence.
