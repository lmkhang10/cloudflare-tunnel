import test from 'node:test';
import assert from 'node:assert/strict';
import { tunnelError, stepState } from '../dist/index.js';

test('creates an actionable English DNS permission error', () => {
  const error = tunnelError('DNS_PERMISSION_DENIED', {
    hostname: 'dev.example.com',
    completedEffects: ['Created tunnel shop-local (abc-123).'],
  });

  assert.equal(error.title, 'DNS permission denied');
  assert.match(error.summary, /dev\.example\.com/);
  assert.deepEqual(error.availableActions, ['sign-in-again', 'retry', 'copy-diagnostics']);
  assert.equal(error.retryFromStep, 'dns-route');
  assert.deepEqual(error.completedEffects, ['Created tunnel shop-local (abc-123).']);
});

test('accepts only declared workflow states', () => {
  assert.equal(stepState('succeeded'), 'succeeded');
  assert.throws(() => stepState('done'), /Unknown workflow step state/);
});

test('uses an actionable fallback for unknown cloudflared failures', () => {
  const error = tunnelError('CLOUDFLARED_COMMAND_FAILED', {
    exitCode: 1,
    stderr: 'unexpected failure',
  });

  assert.equal(error.code, 'CLOUDFLARED_COMMAND_FAILED');
  assert.deepEqual(error.safeDiagnostics, { exitCode: 1, stderr: 'unexpected failure' });
  assert.deepEqual(error.availableActions, ['retry', 'copy-diagnostics']);
});
