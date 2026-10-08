# Cloudflare Tunnel Kit

Expose local projects through Cloudflare Tunnel from a menu bar app, a browser dashboard, or the terminal. Tunnels run in a background service, so they keep running after you close the terminal.

![Cloudflare Tunnel Kit dashboard](https://raw.githubusercontent.com/lmkhang10/cloudflare-tunnel/main/images/demo.png)

## Features

- **Quick Tunnel**: a temporary `trycloudflare.com` URL, no account needed.
- **Custom domain**: your own hostname, with the tunnel, DNS route, and connector set up for you.
- **Menu bar app** for macOS that you can keep in the Dock, with start/stop controls, copy URL, and notifications.
- **Multiple Cloudflare accounts**: each project uses its own account.
- **Runs in the background**: tunnels can start at login, restart after a crash, and come back after an update.
- **Safe by default**: every change is reviewed before it runs, existing DNS records are never replaced without asking, and the UI only listens on `127.0.0.1`.

## Requirements

- Node.js 20 or newer
- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared` on macOS)

## Install

```bash
npm install --global cloudflare-tunnel-kit
```

This adds two commands, `cftunnel` and `cf-tunnel`.

## Quick start

```bash
cftunnel
```

Then choose how to open it:

```text
1. Open the app (menu bar icon + window)
2. Open the dashboard in your browser
3. Use the terminal wizard
```

In the app, click **New tunnel** and pick **Quick Tunnel** or **Custom domain**. Your local app must be running at the URL you enter.

The first time you choose the app, it downloads its runtime (about 100 MB). On macOS it also creates `~/Applications/Cloudflare Tunnel Kit.app`. Open it once, then right-click its Dock icon and choose **Options → Keep in Dock**.

## Cloudflare accounts

Custom domains need a Cloudflare account. Open **Settings → Accounts** to connect one, or use the CLI:

```bash
cftunnel account import --all      # copy existing ~/.cloudflared/cert.pem* files
cftunnel account login --label work
cftunnel account list
```

Signing in never replaces `~/.cloudflared/cert.pem`. When you create a tunnel, choose the account that manages the hostname's domain.

## Commands

| Command | What it does |
|---|---|
| `cftunnel` | Choose the app, the browser dashboard, or the terminal wizard |
| `cftunnel ui` | Open the dashboard |
| `cftunnel tray` | Start the menu bar app |
| `cftunnel daemon start\|stop\|restart\|status` | Manage the background service |
| `cftunnel autostart enable\|disable\|status` | Start the service at login (macOS) |
| `cftunnel start\|stop\|restart\|status --project <id>` | Control a saved project |
| `cftunnel retry --project <id> --replace-dns` | Point a hostname that already has a DNS record at this tunnel |
| `cftunnel account ...` | Manage Cloudflare accounts |
| `cftunnel settings get\|set KEY VALUE` | Read or change settings |
| `cftunnel update [--check]` | Check for or install a new version |
| `cftunnel doctor` | Check Node.js, cloudflared, and accounts |

Run `cftunnel help` for every option.

## Troubleshooting

| Message | Fix |
|---|---|
| The local service refused the connection | Start your local app at the URL shown on the project, then click **Start**. |
| The hostname already has a DNS record | Click **Replace DNS record** if the old record can go, or use another hostname. |
| Cloudflare account not connected / login expired | **Settings → Accounts → Add account** or **Sign in again**. |
| Launch at login points to a missing node | You switched Node versions; click **Repair** in Settings or run `cftunnel autostart enable`. |

`cftunnel daemon status` shows where the logs are kept.

## Privacy and security

- The dashboard and API only listen on `127.0.0.1` and reject requests for other hosts.
- Certificates are stored per account with owner-only permissions; secrets are redacted from logs.
- The only outbound requests besides Cloudflare are the optional daily update checks to npm and GitHub. No telemetry is sent.

## Development

```bash
npm install
npm test
node dist/cli/main.js          # run the local build
```

Publish with `make publish` after bumping the version in `package.json`.

## License

MIT. See [LICENSE](LICENSE).
