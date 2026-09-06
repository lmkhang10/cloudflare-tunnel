# Wizard Drawer UX Hardening

## Goal

Make the tunnel setup drawer reliably closable and improve its interaction and
accessibility behavior without changing tunnel APIs, persistence, or workflow
semantics.

## Root cause

The document-level click handler currently resolves only
`event.target.closest('button')`. The drawer overlay is a `div` carrying
`data-close`, so clicking the overlay never reaches the close branch. The
close lifecycle also has no explicit running-state guard, which makes future
interaction changes likely to dismiss an in-flight workflow accidentally.

## Design

Keep the existing single-page drawer and wizard state machine. Centralize close
intent detection in a small client-side helper that supports close controls of
any element type, while treating the overlay as closeable only when the event
target is the overlay itself. Clicks inside the panel must never close it.

All non-submit close controls will explicitly use `type="button"`. The close
button, Cancel button, direct overlay click, and Escape key will share the same
close lifecycle. Opening continues to set `aria-hidden`, lock body scrolling,
record the trigger, and focus the panel; closing restores scrolling, clears
transient state as appropriate, and returns focus to the trigger when it is
still available.

While the execute step is in progress, close requests are ignored so a user
cannot accidentally abandon an active request. The completion state remains
closable through Done. Existing toast/error handling remains unchanged.

Polish includes visible keyboard focus styling, clearer close-button semantics,
and preserving full-width behavior on small screens. No API, server, database,
Cloudflare command, credential handling, or persistence behavior changes.

## Testing

Extend the UI contract tests to cover:

- drawer semantics and absence of the native dialog/backdrop path;
- close controls using button semantics;
- direct overlay close behavior and panel click protection;
- Escape handling, scroll lock, focus restoration, and running-state guard;
- TypeScript build, full Node test suite, and `git diff --check`.

Because the current UI tests inspect the server-rendered HTML rather than run a
browser, behavioral guarantees will be encoded as source/markup contracts;
browser-level testing is not introduced in this focused change.

## Scope boundary

This change does not implement new product features. Follow-up ideas will be
reported separately after the fix, prioritized by user value and implementation
risk.
