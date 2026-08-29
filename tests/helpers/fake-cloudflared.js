import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scenario = process.env.FAKE_CLOUDFLARED_SCENARIO ?? 'success';
if (process.env.FAKE_CLOUDFLARED_RECORD) {
  appendFileSync(process.env.FAKE_CLOUDFLARED_RECORD, `${JSON.stringify(args)}\n`);
}

if (scenario === 'quick-running') {
  console.log('INF Requesting new quick Tunnel on trycloudflare.com...');
  setTimeout(() => console.log('INF + https://calm-river-123.trycloudflare.com'), 30);
  setInterval(() => console.log('DBG connector heartbeat'), 1000);
} else if (scenario === 'connector-running') {
  console.log('INF Registered tunnel connection');
  setInterval(() => console.log('DBG connector heartbeat'), 1000);
} else if (args[0] === '--version') {
  console.log('cloudflared version 2026.8.0');
} else if (scenario === 'auth-stale' && args.join(' ') === 'tunnel list --output json') {
  console.error('Unable to authenticate origin certificate: token is invalid or revoked');
  process.exitCode = 1;
} else if (args.join(' ') === 'tunnel list --output json') {
  console.log(JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', name: 'shop-local', createdAt: '2026-08-29T00:00:00Z', connections: [] }]));
} else if (args[0] === 'tunnel' && args[1] === 'create') {
  console.log('Tunnel credentials written to /tmp/11111111-1111-4111-8111-111111111111.json. cloudflared chose this file based on where your origin certificate was found.');
  console.log(`Created tunnel ${args[2]} with id 11111111-1111-4111-8111-111111111111`);
} else if (args.join(' ') === 'tunnel login') {
  console.log('You have successfully logged in.');
} else if (args[0] === 'tunnel' && args[1] === 'ingress' && args[2] === 'validate') {
  console.log('Validating rules from test config');
} else if (args[0] === 'tunnel' && args[1] === 'route' && args[2] === 'dns') {
  console.log(`Added CNAME ${args[4]}`);
} else if (args[0] === 'tunnel' && args[1] === 'info') {
  console.log(JSON.stringify({ id: args[2], connections: [{ id: 'connector-1' }] }));
} else {
  console.error(`Unsupported fake command: ${args.join(' ')}`);
  process.exitCode = 2;
}
