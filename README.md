# cloudflare-tunnel-kit

Thư viện mã nguồn mở giúp dự án tạo và tích hợp Cloudflare Tunnel bằng hai cách: command line hoặc live UI chạy cục bộ. Mục tiêu là thay thế các shell script/Makefile rời rạc bằng flow wizard có validation, preview và confirmation rõ ràng.

## Current version

`0.1.0` là bản MVP hiện có:

- Core TypeScript API cho validation, tạo plan, redaction và execution.
- CLI `cf-tunnel` với `init`, `create`, `quick`, `start`, `stop`, `status`, `doctor`, `ui`.
- Profile `custom` và Laravel detection với proposal mapping `APP_URL`.
- Quick tunnel và named-tunnel argv generation.
- Validation URL, hostname, tunnel name và path dưới project root.
- Dry-run, structured errors và prompt an toàn để copy hỏi AI.
- UI HTML/CSS/JS nhẹ, bind loopback, không cần frontend framework.

Laravel `.env` mapping cho `APP_URL` đã có ở dạng proposal/diff; thao tác vẫn cần confirmation và hiện chưa tự động ghi file trong CLI/UI.

## Ý tưởng và nguyên tắc

Flow luôn là: `input -> detect -> validate -> preview plan -> confirm -> execute -> summary`.

Không nối input thành shell command, không in secret ra log, không ghi đè config hoặc `.env` âm thầm. Người dùng luôn nhìn thấy command/file operation trước khi chạy.

## Yêu cầu

- Node.js 20 trở lên.
- `cloudflared` trong `PATH` nếu muốn chạy tunnel thật.
- Quyền Cloudflare phù hợp với loại named tunnel.

## Cài đặt

Khi package được phát hành:

```bash
npm install --save-dev cloudflare-tunnel-kit
```

Trong source checkout:

```bash
npm install
npm run build
node dist/cli/main.js --help
```

## Makefile shortcuts

Nếu thích command ngắn, package có Makefile:

```bash
make setup
make help
make init
make ui
make quick URL=http://127.0.0.1:8000
make create NAME=law-firm URL=http://127.0.0.1:8000
```

`make quick` và `make create` mặc định chỉ preview (`--dry-run`). Sau khi review, dùng CLI trực tiếp để execute và xác nhận rõ ràng.

## CLI text-only

Kiểm tra môi trường:

```bash
cf-tunnel doctor
```

Chạy `cf-tunnel` hoặc `cf-tunnel init` không kèm options để mở interactive wizard text-only. Wizard hỏi từng bước, in lỗi kèm cách sửa, hiển thị command preview và hỏi xác nhận trước khi execute.

Quick tunnel, chỉ validate/preview:

```bash
cf-tunnel quick --url http://127.0.0.1:8000 --dry-run
```

Named tunnel sau khi review plan:

```bash
cf-tunnel create --url http://127.0.0.1:8000 --name my-project --hostname tunnel.example.com
```

Lifecycle commands:

```text
cf-tunnel start --name my-project
cf-tunnel stop --name my-project
cf-tunnel status --name my-project
cf-tunnel init --profile custom --url http://127.0.0.1:8000 --dry-run
```

`--yes` không bỏ qua validation và không bypass confirmation của Laravel `.env`.

## Live UI

```bash
cf-tunnel ui
```

Mở URL được in ra, thường là `http://127.0.0.1:<port>`. Wizard gồm profile, local URL, tunnel name, validation và plan preview. UI chỉ lắng nghe loopback. Nút copy tạo prompt AI đã loại bỏ secret; package không tự gửi prompt đó đi đâu.

## Custom profile

Custom profile không đoán framework:

```bash
cf-tunnel quick --profile custom --url http://127.0.0.1:3000 --dry-run
cf-tunnel create --profile custom --url http://127.0.0.1:8000 --name billing --dry-run
```

## Laravel profile

Laravel adapter kiểm tra `artisan` và `composer.json`, sau đó đề xuất mapping như `APP_URL`, `ASSET_URL` hoặc Reverb URL. Mỗi mapping phải hiện thành diff và cần confirmation riêng. Nếu `.env` thiếu hoặc không rõ, tool dừng với hướng dẫn; không tự đoán và không tự ghi ngầm.

```bash
cf-tunnel create --profile laravel --url http://127.0.0.1:8000 --name law-firm --dry-run
```

## API

```ts
import { validateTunnelConfig, createTunnelPlan, executeTunnelPlan } from 'cloudflare-tunnel-kit';

const config = { profile: 'custom', operation: 'quick', localUrl: 'http://127.0.0.1:8000' };
const validation = validateTunnelConfig(config);
if (!validation.ok) for (const error of validation.issues) console.error(error.code, error.reason, error.fix);
const plan = createTunnelPlan(config);
const result = await executeTunnelPlan(plan, { dryRun: true });
console.log(result);
```

Plan có thể serialize để hiển thị trong hệ thống riêng. Chỉ execute plan đã validated và sau khi người dùng approve confirmation group.

## Error model

Mỗi lỗi có `code`, `field` (nếu có), `reason` và `fix`. Mã thường gặp: `INPUT_INVALID_URL`, `INPUT_INVALID_HOSTNAME`, `INPUT_INVALID_TUNNEL_NAME`, `PATH_OUTSIDE_PROJECT`, `CONFIRMATION_REQUIRED`, `PROCESS_FAILED`.

Khi copy lỗi để hỏi AI, kiểm tra lại prompt đã redact trước khi dán vào dịch vụ bên ngoài.

## Security model

- UI bind `127.0.0.1` mặc định.
- Process chạy argv array với shell disabled.
- Secret-looking key/value, bearer token và credential path được redact.
- File path được kiểm tra dưới project root.
- Dry-run không gọi cloudflared.
- Config overwrite và Laravel `.env` write phải được preview và confirm.
- Không gửi telemetry hoặc diagnostic ra ngoài.

Tool không thay thế việc review Cloudflare account permissions, DNS, access policy hoặc secret management của tổ chức.

## Phát triển

```bash
npm test
npm run build
git diff --check
```

Test dùng Node built-ins và temporary fixtures; không cần Cloudflare account. Khi đóng góp, thêm test trước cho behavior mới và không đưa secret thật vào fixture.

## License

MIT. Xem [LICENSE](LICENSE).
