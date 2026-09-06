# Wizard Drawer UX Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tunnel wizard drawer close reliably through X, Cancel, overlay, and Escape while protecting active execution and improving accessibility.

**Architecture:** Keep the current server-rendered page and client-side wizard state machine in `src/ui/page.ts`. Add explicit close-intent helpers and an execution guard to the existing delegated event handlers; extend the HTML/source-contract tests in `tests/ui-dashboard.test.js`.

**Tech Stack:** TypeScript, server-rendered HTML/CSS/JavaScript strings, Node built-in test runner.

---

### Task 1: Add regression contracts

**Files:**
- Modify: `tests/ui-dashboard.test.js`

- [ ] Add assertions that the close button and Cancel button are explicit non-submit buttons, the overlay has `data-close`, direct overlay handling exists, panel clicks are protected, and execution state is guarded.
- [ ] Run `npm run build && node --test tests/ui-dashboard.test.js` and confirm the new assertions fail because the current source has no overlay-specific handling, no button types, and no running guard.

### Task 2: Fix drawer close lifecycle

**Files:**
- Modify: `src/ui/page.ts`

- [ ] Add `running=false` state and set it only around the `/api/execute` request; reset it after the request settles.
- [ ] Add `canClose(target)` that accepts `data-close` controls and direct clicks on `.drawer-overlay`, while rejecting panel descendants and returning false while running.
- [ ] Update the document click handler to use the helper before button-specific actions; keep `continue` from submitting the form and make close controls `type="button"`.
- [ ] Keep Escape routed through `closeWizard()` but honor the running guard.
- [ ] Add `:focus-visible` styling for close/action controls without changing API or workflow behavior.

### Task 3: Verify and commit the implementation

**Files:**
- Test: `tests/ui-dashboard.test.js`
- Test: `src/ui/page.ts`

- [ ] Run `npm test` and confirm the complete Node suite passes.
- [ ] Run `rg -n 'showModal|<dialog|::backdrop|backdrop-filter' src tests` and confirm no native modal path remains.
- [ ] Run `git diff --check` and inspect `git status --short` to confirm only intended tracked files changed; preserve the unrelated untracked `.tgz`.
- [ ] Commit the UI fix and tests as `fix: harden tunnel wizard drawer closing`.

### Follow-up suggestions

After implementation, report feature ideas separately without adding them to this change: project edit/relink from the dashboard, copyable tunnel URL and health status, restart/stop confirmation, import/export local project settings, and a command preview with downloadable diagnostics.
