import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactValue } from '../dist/index.js';

test('redacts PEM blocks, authorization headers, and query-string secrets', () => {
  const input = 'Authorization: Bearer abc.def.ghi\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\nhttps://x.test/?token=visible';
  const output = redact(input);
  assert.doesNotMatch(output, /abc\.def\.ghi|BEGIN PRIVATE KEY|token=visible/);
  assert.match(output, /\[REDACTED/);
});

test('redacts nested credential-shaped keys', () => {
  assert.deepEqual(redactValue({ safe: 'hello', account: { apiToken: 'visible' } }), { safe: 'hello', account: { apiToken: '[REDACTED]' } });
});
