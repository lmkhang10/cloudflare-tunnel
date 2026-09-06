# UI Port and Project Health Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the local UI to use a fixed or explicitly selected loopback port and expose safe per-project health details.

**Architecture:** Preserve the existing HTTP server and dashboard. Resolve UI port in the CLI using flag, environment, then `0`; keep loopback binding. Add a lightweight details panel that reads the existing project-detail endpoint and renders only health/log fields.

**Tech Stack:** TypeScript, Node HTTP server, server-rendered HTML/JavaScript, Node test runner.

---

### Task 1: Add failing UI and CLI contracts

**Files:**
- Modify: `tests/ui-dashboard.test.js`
- Modify: `tests/cli.test.js`

- [ ] Assert project cards expose a Details action and the page contains project-detail fetching/rendering.
- [ ] Assert CLI help documents `--port PORT` and the environment variable.
- [ ] Run the focused tests and confirm the new assertions fail.

### Task 2: Implement port selection

**Files:**
- Modify: `src/cli/main.ts`
- Modify: `README.md`

- [ ] Add a numeric port resolver with precedence `--port`, `CLOUDFLARE_TUNNEL_KIT_UI_PORT`, then `0`; reject non-integer values outside `0..65535` with an actionable error.
- [ ] Pass the resolved port to `server.listen(port, '127.0.0.1')` and document fixed/automatic behavior.

### Task 3: Implement safe project details UI

**Files:**
- Modify: `src/ui/page.ts`
- Modify: `tests/ui-dashboard.test.js`

- [ ] Add a Details button and hidden details region per card.
- [ ] Fetch `/api/projects/:id`, render health and redacted logs through existing escaping, and provide close behavior.
- [ ] Keep credentials and credential paths out of the rendered details.

### Task 4: Verify and commit

- [ ] Run `npm test` and record any sandbox-only loopback failures.
- [ ] Run `git diff --check` and inspect status.
- [ ] Commit as `feat: add configurable UI port and project details`.
