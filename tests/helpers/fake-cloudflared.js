import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const raw = process.argv.slice(2);
const scenario = process.env.FAKE_CLOUDFLARED_SCENARIO ?? 'success';
if (process.env.FAKE_CLOUDFLARED_RECORD) {
  appendFileSync(process.env.FAKE_CLOUDFLARED_RECORD, `${JSON.stringify(raw)}\n`);
}

// Normalize `tunnel [global flags] <subcommand>` so scenarios match on the subcommand only.
const options = {};
const args = [];
for (let index = 0; index < raw.length; index++) {
  const value = raw[index];
  if (['--origincert', '--protocol', '--loglevel', '--config', '--credentials-file', '--output', '--url'].includes(value)) { options[value.slice(2)] = raw[++index]; continue; }
  if (value === '--no-autoupdate' || value === '--overwrite-dns') { options[value.slice(2)] = true; continue; }
  args.push(value);
}
const command = args.join(' ');
const fakeCert = account => `-----BEGIN ARGO TUNNEL TOKEN-----\n${Buffer.from(JSON.stringify({ zoneID: 'b'.repeat(32), accountID: account, apiToken: 'fake-api-token-value' })).toString('base64')}\n-----END ARGO TUNNEL TOKEN-----\n`;

if (scenario === 'quick-running') {
  console.log('INF Requesting new quick Tunnel on trycloudflare.com...');
  setTimeout(() => console.log('INF + https://bulletin-tribe-catalog-pleasure.trycloudflare.com'), 30);
  setInterval(() => console.log('DBG connector heartbeat'), 1000);
} else if (scenario === 'connector-running') {
  console.log('INF Registered tunnel connection');
  setInterval(() => console.log('DBG connector heartbeat'), 1000);
} else if (scenario === 'connector-crash') {
  console.log('INF Registered tunnel connection');
  setTimeout(() => process.exit(1), 50);
} else if (args[0] === '--version') {
  console.log('cloudflared version 2026.8.0');
} else if (scenario === 'auth-stale' && command === 'tunnel list') {
  console.error('Unable to authenticate origin certificate: token is invalid or revoked');
  process.exitCode = 1;
} else if (scenario === 'auth-missing' && command === 'tunnel list') {
  console.error('Cannot determine default origin certificate path. No file cert.pem in [~/.cloudflared ~/.cloudflare-warp]');
  process.exitCode = 1;
} else if (command === 'tunnel list') {
  console.log(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', name: 'shop-local', createdAt: '2026-08-29T00:00:00Z', connections: [] }]));
} else if (args[0] === 'tunnel' && args[1] === 'create') {
  const file = options['credentials-file'] ?? '/tmp/11111111-1111-4111-8111-111111111111.json';
  if (options['credentials-file']) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ AccountTag: 'a'.repeat(32), TunnelID: '11111111-1111-4111-8111-111111111111' })); }
  console.log(`Tunnel credentials written to ${file}. cloudflared chose this file based on where your origin certificate was found.`);
  console.log(`Created tunnel ${args.at(-1)} with id 11111111-1111-4111-8111-111111111111`);
} else if (command === 'tunnel login') {
  console.log('Please open the following URL and log in with your Cloudflare account:\n\nhttps://dash.cloudflare.com/argotunnel?aud=&callback=https%3A%2F%2Flogin.cloudflareaccess.org%2Ffake\n');
  if (scenario === 'login-fails') { console.error('Failed to write the certificate.'); process.exitCode = 1; }
  else {
    const dir = path.join(process.env.HOME, '.cloudflared');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'cert.pem'), fakeCert(process.env.FAKE_CERT_ACCOUNT ?? 'c'.repeat(32)));
    console.log('You have successfully logged in.');
  }
} else if (args[0] === 'tunnel' && args[1] === 'ingress' && args[2] === 'validate') {
  console.log(`Validating rules from ${options.config}`);
} else if (scenario === 'dns-exists' && args[1] === 'route' && !raw.includes('--overwrite-dns')) {
  console.error('Failed to add route: code: 1003, reason: Failed to create record dev.example.com with err An A, AAAA, or CNAME record with that host already exists.');
  process.exitCode = 1;
} else if (args[0] === 'tunnel' && args[1] === 'route' && args[2] === 'dns') {
  console.log(`Added CNAME ${args[4]}`);
} else if (args[0] === 'tunnel' && args[1] === 'info') {
  console.log(JSON.stringify({ id: args[2], connections: [{ id: 'connector-1' }] }));
} else {
  console.error(`Unsupported fake command: ${raw.join(' ')}`);
  process.exitCode = 2;
}
