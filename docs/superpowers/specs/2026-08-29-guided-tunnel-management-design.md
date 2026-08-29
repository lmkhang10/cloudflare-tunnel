# Guided Tunnel Management Design

## Status

Approved for implementation planning on 2026-08-29.

## Context

The current package can generate and execute individual `cloudflared` commands, but it does not yet provide a complete end-user workflow. A named tunnel requires authentication, tunnel creation, local configuration, a DNS route, a long-running connector process, and health verification. The current implementation does not orchestrate all of those steps, does not persist project state, and treats long-running tunnel processes like short-lived commands.

This design turns Cloudflare Tunnel Kit into a local, open-source tunnel manager that a typical user can operate through either a terminal wizard or a browser wizard without manually composing Cloudflare commands.

All user-facing product text must be English.

## Product principles

1. The shortest successful path must be obvious.
2. Validation happens before mutation whenever Cloudflare permits it.
3. A failure must explain what failed, what already succeeded, and what the user should do next.
4. Retry must resume safely without creating duplicate tunnels, DNS records, or config files.
5. Local state and generated runtime files stay outside the project repository by default.
6. Cloudflare credentials and certificates are never copied into the database, logs, diagnostics, or repository.
7. UI and CLI are two presentations of the same workflow engine.
8. Destructive Cloudflare actions are separate from removing local dashboard records and always require explicit confirmation.

## Scope

The next release supports:

- Quick Tunnels for HTTP and HTTPS origins without Cloudflare login.
- Locally managed named tunnels with one public hostname and one local origin.
- Browser-based `cloudflared tunnel login` with automatic workflow continuation.
- Tunnel creation or safe reuse, local config generation, ingress validation, DNS routing, connector startup, and health verification.
- A local SQLite project dashboard with resumable workflows and event history.
- Start, stop, restart, status, redacted logs, retry, and reconciliation.
- Interactive terminal and browser wizards.
- Non-interactive command flags for advanced users and automation.
- macOS, Linux, and Windows path and process behavior.
- Git safety checks for generated files and Cloudflare credentials.

The next release does not support:

- Purchasing or registering a root domain.
- Adding a root domain to a Cloudflare account.
- Cloudflare API tokens as an alternate authentication mechanism.
- Multiple ingress services or hostnames per tunnel.
- Cloudflare Access policy creation.
- Installing the connector as an operating system service.
- Synchronizing state between machines.
- Production deployment orchestration.

Cloudflare does not provide a permanent custom domain through Quick Tunnels. Quick mode receives an ephemeral `trycloudflare.com` URL. Named mode requires a domain already added to the user's Cloudflare account.

## Primary entrypoints

The primary terminal entrypoint is:

```bash
npx cf-tunnel
```

It opens an interactive terminal wizard:

```text
What would you like to do?

> Create a Quick Tunnel
  Set up a custom domain
  Open a saved project
  Check system requirements
```

The primary browser entrypoint is:

```bash
npx cf-tunnel ui
```

It starts a loopback-only server, prints its URL immediately, opens the default browser when possible, and keeps the server process running until explicitly stopped. `--no-open` disables automatic browser launch.

Direct commands remain available:

```text
cf-tunnel quick
cf-tunnel create
cf-tunnel start
cf-tunnel stop
cf-tunnel restart
cf-tunnel status
cf-tunnel doctor
cf-tunnel ui
```

Missing interactive arguments start the relevant wizard at the first incomplete step. In a non-interactive environment, the command returns a structured `INTERACTIVE_INPUT_REQUIRED` error, lists missing fields, and prints a complete example command. `--json` emits machine-readable events and results. `--yes` confirms an already validated plan but cannot bypass destructive confirmations, authentication, invalid input, stale plans, credential warnings, or Git safety warnings.

`Ctrl+C` cancels the current operation safely, records the draft or completed workflow steps, and shuts down child processes started by the current operation when appropriate.

## User journeys

### Quick Tunnel

1. Select or detect a project.
2. Enter the local HTTP or HTTPS URL.
3. Verify the origin is reachable from the local machine.
4. Show a non-mutating plan.
5. Start `cloudflared` under the process supervisor.
6. Parse the generated `trycloudflare.com` URL from process output.
7. Display connection state, URL, Copy, Open, Stop, and redacted logs.
8. Persist the local project and session record.

Quick Tunnel startup must not hold an HTTP request open while waiting for the connector process to terminate. The UI receives progress events and the process supervisor owns the long-running child process.

### Named tunnel with a custom hostname

1. Select or detect a project.
2. Enter local URL, tunnel name, and full hostname.
3. Run environment, input, origin, filesystem, and Git preflight checks.
4. Check Cloudflare authentication using a read-only command.
5. If authentication is absent or stale, launch `cloudflared tunnel login`, display the login URL when browser launch fails, and wait for completion.
6. Re-run the read-only authentication and account-access check.
7. Discover whether the named tunnel already exists.
8. Present a plan to create a new tunnel or adopt the existing matching tunnel.
9. After confirmation, create the tunnel if required and capture its UUID and credential-file path from structured or validated output.
10. Generate the application-owned config outside the repository.
11. Validate ingress configuration with `cloudflared` before DNS mutation.
12. Create the DNS route for the requested hostname.
13. Start the connector under the process supervisor.
14. Verify process health, Cloudflare connector health, and public hostname behavior separately.
15. Persist state and show the project dashboard.

If a step fails, completed resources are retained. Retry begins at the failed step after reconciling actual local and Cloudflare state. The application never automatically deletes a tunnel or DNS record as rollback.

## Workflow engine

The UI and CLI call one workflow engine. Presentation code cannot invoke `cloudflared` directly.

Each workflow step has one of these states:

```text
pending | running | succeeded | warning | failed | skipped | cancelled
```

Named tunnel steps are:

```text
environment
input
origin
filesystem
git-safety
authentication
account-access
tunnel
configuration
ingress-validation
dns-route
connector
cloudflare-health
public-health
```

Every step records timestamps, attempt count, safe output, structured error, and the identifiers of resources it confirmed or created. A step must be idempotent: it first observes current state, determines whether the desired state already exists, and mutates only when necessary.

Before resuming, the engine reconciles:

- Project path and framework evidence.
- Generated config and its content fingerprint.
- Tunnel credential-file existence without reading or persisting secret content.
- Tunnel UUID/name from `cloudflared tunnel list` or `info`.
- Connector process identity and liveness.
- DNS-route command outcome and current tunnel association when observable.
- Public endpoint health.

The engine must distinguish a matching existing resource from a conflicting resource. It may adopt only when the user confirms the displayed identity and configuration. It must never overwrite or delete an existing DNS record to make setup succeed.

## Validation and preflight

Validation is grouped so the UI can display exactly what is being checked.

### Environment

- Supported Node.js version.
- `cloudflared` executable discovery and version output.
- Writable application-data directory.
- SQLite database availability and migration status.
- Ability to bind the loopback UI.
- Operating-system browser launch capability, treated as optional.
- Cloudflare network connectivity diagnostics when a connector cannot connect, including guidance about outbound port `7844`.

The application does not install `cloudflared` silently. `doctor` provides platform-specific official installation guidance.

### Inputs

- Local URL is absolute HTTP or HTTPS.
- Host and port are valid and safe.
- Tunnel name follows Cloudflare-compatible and shell-independent constraints.
- Hostname is a normalized fully qualified DNS hostname.
- Hostname is not an IP address, localhost name, wildcard, URL, or path.
- Quick mode does not accept named-tunnel-only fields silently.
- Named mode requires tunnel name and hostname.

Internationalized domain names must be normalized consistently to ASCII form before comparison and command execution while preserving a safe display form.

### Origin

- DNS resolution where applicable.
- TCP connectivity.
- TLS handshake for HTTPS origins.
- HTTP response with redirect limits and bounded timeout.
- Distinct warnings for connection refused, timeout, certificate failure, redirect loop, and HTTP 5xx.

An HTTP 4xx response proves that an origin is reachable and is therefore a warning rather than a connectivity failure. The user may continue after reviewing warnings. TLS verification is enabled by default; disabling it is an advanced, explicit setting with a security warning.

### Authentication and permissions

The application treats these states separately:

- Not authenticated: no usable account certificate.
- Authentication stale or revoked: certificate exists but read-only commands fail authentication.
- Account access denied: login succeeded but tunnel listing or management is denied.
- Zone mismatch or DNS permission denied: tunnel operations work but hostname routing is not permitted.
- Credentials missing: a tunnel exists but its local tunnel credential file is unavailable.

Not every DNS write permission can be proven without attempting the DNS route. When that operation fails, the UI must state that the tunnel may already exist, DNS was not changed, and Retry will resume at DNS after the user fixes access.

The account certificate is account-scoped and sensitive. The application never reads it for parsing, copies it, changes its permissions, includes it in diagnostics, or stores its content or fingerprint in SQLite.

### Configuration and hostname

- Generated config is parsed and validated before use.
- Credentials path exists and points to a regular file.
- Config points to the intended tunnel UUID and local URL.
- Ingress rules match the requested hostname and include a terminal fallback when ingress syntax requires it.
- Existing application-owned config changes are previewed and written atomically with backup.
- Non-application-owned config is not overwritten.
- Multi-level hostnames receive an SSL coverage warning because they may require an Advanced Certificate.
- Existing A, AAAA, or CNAME conflicts are reported without deletion or overwrite.

## Error model and recovery UX

Errors have stable English codes and these fields:

```text
code
title
summary
likelyCause
completedEffects
remediationSteps
availableActions
safeDiagnostics
retryFromStep
```

Core codes include:

```text
CLOUDFLARED_NOT_FOUND
CLOUDFLARED_VERSION_UNSUPPORTED
ORIGIN_CONNECTION_REFUSED
ORIGIN_TIMEOUT
ORIGIN_TLS_INVALID
AUTH_REQUIRED
AUTH_STALE
ACCOUNT_ACCESS_DENIED
ZONE_MISMATCH
DNS_PERMISSION_DENIED
DNS_RECORD_CONFLICT
TUNNEL_NAME_CONFLICT
TUNNEL_CREDENTIALS_MISSING
CONFIG_CONFLICT
INGRESS_INVALID
CONNECTOR_START_FAILED
CONNECTOR_DISCONNECTED
PUBLIC_HOSTNAME_UNHEALTHY
GIT_SENSITIVE_FILE_TRACKED
DATABASE_MIGRATION_FAILED
INTERACTIVE_INPUT_REQUIRED
```

A user-facing failure shows:

1. The failed step.
2. A plain-English explanation.
3. Resources already created or changed.
4. Numbered remediation steps.
5. Contextual actions such as Retry, Sign in again, Change hostname, Open Cloudflare Dashboard, or Copy diagnostics.

Raw stderr can appear only in an expandable redacted diagnostics section. Unknown errors use `CLOUDFLARED_COMMAND_FAILED`, retain safe command metadata and exit status, and provide an actionable fallback instead of displaying only `PROCESS_FAILED`.

## Process supervision and health

Short-lived commands and long-running connectors use different execution APIs.

The command runner captures bounded stdout/stderr, supports cancellation, and returns an exit result. The process supervisor starts a connector, streams bounded redacted logs, tracks process identity, exposes status, and stops it gracefully.

The supervisor must:

- Avoid shell execution and pass argv arrays.
- Prevent duplicate local connectors for the same managed tunnel unless explicitly supported later.
- Use a project/tunnel operation lock to prevent duplicate setup from multiple UI tabs or CLI processes.
- Detect stale stored PIDs and avoid signaling an unrelated process after PID reuse by validating process identity.
- Send a graceful signal first, then offer a force-stop action after a timeout.
- Mark sessions stale after application restart until reconciled.
- Keep a tunnel running when the browser tab closes.
- Report when terminating the UI host process will also terminate its managed child connectors.

Health is reported in three independent layers:

```text
Local process: running | stopped | unknown
Cloudflare connector: healthy | degraded | disconnected | unknown
Public hostname: healthy | warning | unavailable | unchecked
```

The dashboard must not label a tunnel simply `Running` based only on a SQLite value.

## Local persistence

The application uses one SQLite database per operating-system user. It is stored in the platform application-data directory:

```text
macOS:   ~/Library/Application Support/cloudflare-tunnel-kit/state.db
Linux:   ${XDG_DATA_HOME:-~/.local/share}/cloudflare-tunnel-kit/state.db
Windows: %LOCALAPPDATA%\cloudflare-tunnel-kit\state.db
```

Generated project runtime files are stored beside the database under an application-managed `projects/<local-project-id>/` directory. They do not live in the source repository by default.

The schema contains focused records for:

- `projects`: local identity, display name, absolute path, detected profile, timestamps.
- `tunnels`: project relation, kind, name, UUID, hostname, desired local URL, config path, credential path reference, timestamps.
- `workflow_runs`: workflow kind, overall state, current step, start/end timestamps.
- `workflow_steps`: step state, attempts, safe result, structured error, effects, timestamps.
- `process_sessions`: tunnel relation, validated process identity, PID when available, lifecycle timestamps, ephemeral Quick Tunnel URL.
- `events`: redacted user-visible history with severity and resource references.
- `installations`: detected `cloudflared` and Node.js versions and last-check time.
- `schema_migrations`: applied migration versions and timestamps.

SQLite uses transactions, foreign keys, WAL mode where the platform permits it, bounded busy timeouts, and versioned forward migrations. A backup is created before migration. A migration failure leaves the prior database intact and opens the application in a recoverable read-only state.

The database is desired-state and history storage, not runtime truth. Reconciliation updates stale records based on current files, processes, and Cloudflare observations. A rebuild operation can reconstruct useful project/tunnel records from application-managed project directories and `cloudflared` read-only commands, but cannot recreate lost event history.

Quick Tunnel URLs are historical session data and must be marked expired after the corresponding connector stops.

## Git and filesystem safety

The default layout keeps the SQLite database, generated configs, logs, runtime metadata, and backups outside every repository. The application does not modify `.gitignore` by default.

If a user explicitly chooses a config path inside a Git worktree, the wizard offers:

1. Move the config to application data, recommended.
2. Add the path to `.git/info/exclude`, affecting only the current clone.
3. Add a rule to `.gitignore`, affecting the team and requiring a separate explicit confirmation.

Before applying a local exclude, the application previews the exact file and rule. It preserves existing formatting and avoids duplicate entries.

Git safety detects whether generated config, tunnel credential JSON, `cert.pem`, private keys, or token-like files are tracked or staged. It emits a high-severity warning with safe remediation. It does not automatically unstage, restore, delete, rewrite history, or remove a tracked file.

Project deletion, movement, and cloning are handled explicitly:

- Missing paths are shown as `Project path missing` and can be relinked.
- A new clone is a separate local project unless the user explicitly relinks it.
- Removing a dashboard project does not delete repository files or Cloudflare resources.
- Deleting application-owned local config or logs requires a separate confirmation.

## Browser UI

The UI binds to `127.0.0.1` by default and prints the actual selected port before attempting browser launch. Bind failures are handled with a clear error rather than an unhandled server event.

The browser experience contains:

- Project list with `Running`, `Stopped`, `Setup incomplete`, `Needs attention`, and `Unknown` states.
- A step-by-step setup wizard with one decision per screen.
- Back navigation before the first mutation.
- A review plan showing commands conceptually, local file effects, and Cloudflare effects.
- Live progress through server-sent events or an equivalent local event stream.
- Contextual recovery actions on failed steps.
- Project detail with settings, config summary, connector health, public URL, redacted logs, and event history.
- Explicit Start, Stop, Restart, Edit settings, Resume setup, Reconcile, Remove locally, and Delete from Cloudflare actions.

Destructive actions name the exact tunnel, UUID, hostname, DNS effect, and local files involved. Removing a local record and deleting Cloudflare resources cannot share one ambiguous button.

Mutation requests require an ephemeral same-session token, same-origin checks, loopback-only access, bounded request bodies, and content-type validation. No telemetry or diagnostics leave the machine automatically.

## Terminal UI

The terminal wizard follows the same steps, error text, and action availability as the browser UI. It supports accessible plain-text output and does not depend on color to convey state.

Each screen asks one question. Review and confirmation occur immediately before the first mutation. After a failure, the wizard remains at the failed step and offers only relevant actions. Saved incomplete workflows appear under `Open a saved project` and can be resumed.

Direct commands use the same validation and workflow engine. Interactive and non-interactive invocations must produce equivalent plans and effects for equivalent inputs.

## Public exposure warning

A successful tunnel makes the configured application reachable through Cloudflare; it does not add application authentication. Before first named public exposure, the review screen warns the user not to publish admin panels, development debug pages, databases, or sensitive internal services without appropriate access controls. Cloudflare Access policy management remains out of scope, but official guidance is linked from the UI and README.

## Diagnostics and privacy

Diagnostics are local and opt-in to copy. Redaction covers:

- Account certificates and private keys.
- Tunnel credential contents.
- API tokens, bearer tokens, cookies, and authorization headers.
- Secret-looking environment keys and values.
- Query-string secrets.
- User-home paths when not necessary for remediation.

Logs are bounded by size and retention. Users can clear logs separately from project and Cloudflare resources. Exported diagnostics include application version, platform, safe command name and argv shape, exit status, workflow states, and redacted errors.

## Open-source maintainability

- Core workflows depend on interfaces for Cloudflare commands, process supervision, persistence, clocks, and browser launch.
- CI uses fake adapters and temporary application-data directories; it never requires a Cloudflare account.
- Database migrations are deterministic and covered by upgrade tests.
- Error classifiers use fixture stderr from documented scenarios and always retain an unknown-error fallback.
- Platform-specific behavior is isolated behind small adapters.
- User-visible strings are centralized so terminology remains consistent and future localization does not require changing workflow logic.
- The README documents Quick versus named tunnels, domain ownership requirements, credential sensitivity, public exposure, local state location, cleanup semantics, and troubleshooting.

## Testing strategy

### Unit tests

- Input normalization and validation, including IDN hostname handling.
- Origin check classification.
- Error classification and remediation mapping.
- Plan idempotency decisions.
- Redaction and diagnostic export.
- Application-data path resolution on all supported platforms.
- SQLite repositories, migrations, backup behavior, and reconciliation rules.
- Git tracked/staged detection and local-exclude editing.
- Process identity and stale PID validation.

### Integration tests

- Full Quick Tunnel workflow using a fake long-running `cloudflared` executable that emits a generated URL.
- Named workflow with login required, login success, create, config, ingress validation, DNS route, run, and health.
- Permission failure after tunnel creation followed by successful DNS retry without duplicate tunnel creation.
- Existing matching tunnel adoption and conflicting tunnel refusal.
- Existing DNS record conflict without overwrite.
- Missing credentials and stale authentication recovery.
- UI progress stream and reconnect behavior.
- CLI wizard resume after cancellation.
- UI restart with SQLite reconciliation of stopped and live processes.

### End-to-end smoke tests

- Start the loopback UI, verify the printed URL responds, complete a fake Quick Tunnel, stop it, reopen the UI, and inspect saved history.
- Complete the terminal wizard against a fake Cloudflare environment.
- Verify generated runtime files remain outside a temporary Git repository.
- Verify all user-visible snapshots are English.

Real Cloudflare account tests are optional, manually triggered, isolated from CI, and must use explicitly designated test resources.

## Acceptance criteria

The feature is complete when:

1. A new user can obtain a Quick Tunnel URL through one guided flow without Cloudflare login.
2. A user with an existing Cloudflare-managed domain can complete named-tunnel setup without manually running a Cloudflare command.
3. Authentication opens the browser when possible, presents a fallback URL, and resumes automatically after success.
4. Permission and configuration failures identify the failed step, preserve completed resources, and provide a safe Retry path.
5. Retrying never creates duplicate tunnels, DNS routes, or application-owned configs.
6. Long-running connectors do not block UI requests or terminate because of short-command timeouts.
7. Closing and reopening the UI restores projects and reconciles actual status before displaying it.
8. Generated state remains outside Git repositories by default, and sensitive tracked/staged files produce a high-severity warning.
9. No secret content is stored in SQLite, logs, diagnostics, test fixtures, or generated repository files.
10. CLI and UI produce equivalent plans and workflow outcomes.
11. All product-facing text is English.
12. Automated tests cover successful flows, recovery flows, lifecycle handling, persistence, security boundaries, and platform path behavior.

