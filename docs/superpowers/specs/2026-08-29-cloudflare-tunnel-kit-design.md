# Cloudflare Tunnel Kit — MVP Design

## Context

Các dự án hiện phải tự viết shell script hoặc Makefile để gọi `cloudflared`. Makefile tham khảo có các flow `tunnel-init`, named tunnel, quick tunnel, stop và status, nhưng chưa có validation tập trung, preview thay đổi, API tái sử dụng hay giao diện wizard.

## Goals

- Cung cấp một thư viện TypeScript mã nguồn mở để dự án khác tích hợp bằng API.
- Cung cấp CLI wizard text-only với các lệnh ngắn, dễ nhớ.
- Cung cấp local UI wizard live để xem validation, plan và kết quả theo từng bước.
- Hỗ trợ profile `custom` và `laravel`.
- Validate đầy đủ trước khi tạo/chạy tunnel, trả lỗi có mã, nguyên nhân và cách sửa.
- Không âm thầm sửa file hoặc ghi đè cấu hình; mọi mutation phải có preview và confirmation.
- Giữ dependency và surface area nhỏ, ưu tiên an toàn mặc định.

## Non-goals for MVP

- Không quản lý Cloudflare account/API token từ xa.
- Không tự động deploy production.
- Không tự động tạo DNS record.
- Không gửi dữ liệu lỗi ra dịch vụ AI; nút copy chỉ tạo prompt đã redact để người dùng tự dán.
- Không tự động ghi `.env` trong Laravel.

## Proposed structure

```text
src/
  core/          schema, normalization, validation, plan, errors, redaction
  providers/     cloudflared executable and process runner
  adapters/      custom and laravel project detection/mapping
  cli/           text wizard and commands
  ui/            localhost HTTP server and static wizard assets
tests/
```

The core must not import CLI or UI code. Adapters produce a normalized `TunnelConfig` and a list of optional project operations. The provider executes only a validated plan.

## User flows

### CLI

- `cf-tunnel init`: inspect the project and interactively create a config plan.
- `cf-tunnel create`: create or start a named tunnel after validation and confirmation.
- `cf-tunnel quick`: start an ephemeral quick tunnel for a local URL.
- `cf-tunnel start`, `stop`, `status`: lifecycle operations.
- `cf-tunnel doctor`: report missing binary, invalid config, port conflicts and auth prerequisites.
- `cf-tunnel ui`: bind the UI to `127.0.0.1` and open/print its URL.

Every mutating command supports `--dry-run`. `--yes` is intentionally restricted and cannot bypass Laravel `.env` confirmation.

### UI

The UI is a static, dependency-light wizard served only on loopback by default. Steps are:

1. Choose profile and operation.
2. Enter local URL, tunnel name, hostname and config path.
3. Detect project and show profile-specific fields.
4. Validate all fields and environment prerequisites.
5. Show an explicit redacted plan of commands and file operations.
6. Ask for confirmation per mutation group.
7. Execute and show structured result.

Errors include stable code, field/step, explanation, suggested fix, and a copy button. The copied AI prompt includes context and redacted diagnostics only.

## Configuration and safety

`TunnelConfig` contains operation, profile, local URL, tunnel name, hostname, config path and optional Laravel mapping choices. Secrets are represented as references, never values, in plans and logs.

- Validate URL scheme, hostname, tunnel name, ports and paths before process launch.
- Resolve executable arguments as an argv array; never concatenate user input into a shell command.
- Restrict project file writes to the selected project root and reject symlink escapes.
- Default config writes to a new file; refuse overwrite unless explicitly confirmed.
- Create a backup before an approved existing-file update.
- Read `.env` without printing secret values.
- Bind UI to loopback and require an ephemeral mutation token plus same-origin checks.
- Redact tokens, certificates, cookies, private keys and values of secret-looking environment keys.
- Apply timeouts and terminate child processes on cancellation.

## Laravel adapter

Detection requires `artisan` and `composer.json` with Laravel evidence. The adapter can propose mappings such as `APP_URL`, `ASSET_URL`, and optional Reverb URL variables, but presents every proposed `.env` change as a diff. The user must explicitly select and confirm each mapping. If `.env` is absent or ambiguous, the adapter reports a fix instead of guessing.

## Error model

Errors use a stable code such as `INPUT_INVALID_URL`, `CLOUDFLARED_NOT_FOUND`, `CLOUDFLARED_AUTH_REQUIRED`, `CONFIG_EXISTS`, `LARAVEL_ENV_CONFIRMATION_REQUIRED`, or `PROCESS_FAILED`. Each error has a safe message, affected input/operation, remediation text, and optional redacted diagnostic context. A run returns a summary containing passed checks, skipped operations, and failed operations.

## Public API

The first public API is intentionally small:

```ts
validateTunnelConfig(input): ValidationResult
createTunnelPlan(input, context): Promise<TunnelPlan>
createLaravelPlan(input, context): Promise<TunnelPlan>
executeTunnelPlan(plan, options): Promise<ExecutionSummary>
```

Plans are inspectable and serializable. Execution rejects plans that are stale, unvalidated, or missing required confirmations.

## Testing and acceptance

- Unit tests cover normalization, validation, redaction, path containment, Laravel detection and `.env` diff generation.
- Provider tests use a fake executable and verify argv handling, timeout and redaction.
- CLI tests verify text-only wizard summaries and confirmation gates.
- UI tests verify wizard transitions, validation rendering and copy-prompt output.
- A smoke test starts the UI on loopback and exercises a dry-run custom plan.
- README is text-only and documents current version, install, CLI, UI, custom profile, Laravel profile, security model, troubleshooting and contribution guidance.

The MVP is complete only when all tests pass and the README examples are verified against the actual CLI help/output.
