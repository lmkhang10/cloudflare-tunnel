# Drawer Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Chrome-stuttering native wizard modal with a right-side drawer while preserving the existing tunnel setup flow.

**Architecture:** Keep the existing single-page wizard and state machine in `src/ui/page.ts`. Replace the native dialog element with an explicit overlay plus fixed drawer panel, and centralize open/close behavior in the existing page script. Update UI tests to assert the new structure and lifecycle.

**Tech Stack:** TypeScript, server-rendered HTML/CSS/JS strings, Node test runner.

---

### Task 1: Inspect and extend UI coverage

**Files:**
- Modify: `tests/ui-dashboard.test.js`
- Test: `src/ui/page.ts`

- [ ] Read existing dashboard assertions and add checks for `.drawer`, `.drawer-overlay`, `role="dialog"`, `aria-modal="true"`, no `<dialog>`, and no `backdrop-filter`.
- [ ] Add source assertions for Escape handling, body scroll lock, overlay close, and focus restoration.
- [ ] Run `node --test tests/ui-dashboard.test.js` and confirm the new assertions fail against the current native dialog implementation.

### Task 2: Replace modal markup and CSS with drawer primitives

**Files:**
- Modify: `src/ui/page.ts` CSS block and wizard markup

- [ ] Replace `<dialog id="wizard">` with a root drawer container containing an overlay and panel.
- [ ] Preserve all existing wizard content and IDs inside the panel.
- [ ] Add fixed positioning, right-side width, mobile full-width behavior, hidden/open state, and transitions using only `transform` and `opacity`.
- [ ] Remove `dialog`, `dialog::backdrop`, and `backdrop-filter` styles.
- [ ] Keep the existing visual hierarchy and button styling while avoiding animated layout properties.

### Task 3: Update drawer lifecycle

**Files:**
- Modify: `src/ui/page.ts` client script

- [ ] Track the last trigger element when opening Quick Tunnel or named-tunnel setup.
- [ ] Open by toggling drawer state, setting `aria-hidden`, locking `document.body` scrolling, and focusing the first drawer control.
- [ ] Close from close buttons, Cancel, overlay click, and Escape; restore body scrolling and trigger focus.
- [ ] Keep all existing stage transitions, validation, plan, execute, toast, and result behavior unchanged.

### Task 4: Verify and polish

**Files:**
- Modify: `tests/ui-dashboard.test.js` if assertions need exact current markup adjustments

- [ ] Run `npm test`.
- [ ] Run `git diff --check`.
- [ ] Search for remaining native modal references with `rg -n 'showModal|<dialog|::backdrop|backdrop-filter' src tests` and ensure none remain in the implementation.
- [ ] Review the final diff for unrelated changes and report verification results.
