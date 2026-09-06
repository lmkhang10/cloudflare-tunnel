# Drawer-based tunnel wizard

## Goal

Replace the current native `<dialog>` wizard because its Chrome rendering path
can stutter when combined with a blurred backdrop and a large shadow. All
wizard-related modal behavior should use one explicit drawer implementation.

## Design

The wizard becomes a right-side drawer composed of a fixed overlay and a fixed
panel. The panel keeps the existing three-step form, review state, running
output, buttons, and copy. Desktop width remains close to the current modal
width (680px); on small screens it becomes full width.

Opening and closing animate only `transform` and `opacity`. The overlay has a
simple translucent background and no `backdrop-filter`. No dimensions,
box-shadow, or layout properties are animated.

The drawer uses dialog semantics through `role="dialog"`,
`aria-modal="true"`, and an accessible label. While open, document scrolling
is disabled. Escape, the close button, Cancel, and clicking the overlay close
the drawer. Focus returns to the triggering button after close.

The existing wizard state machine and API calls remain unchanged. Only the
presentation structure, selectors, open/close lifecycle, and related UI tests
are updated. There is one shared drawer path for Quick Tunnel and named-tunnel
flows.

## Verification

- Build TypeScript output.
- Run the full Node test suite.
- Run the UI/security tests covering drawer visibility, close actions, Escape,
  overlay behavior, scroll locking, and absence of the old native dialog path.
- Run `git diff --check`.
