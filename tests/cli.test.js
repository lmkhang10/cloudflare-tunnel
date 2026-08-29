import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mainMenu } from '../dist/cli/wizard.js';

test('terminal wizard presents the four primary English choices', () => {
  const output = mainMenu();
  assert.match(output, /Create a Quick Tunnel/);
  assert.match(output, /Set up a custom domain/);
  assert.match(output, /Open a saved project/);
  assert.match(output, /Check system requirements/);
});

test('non-interactive invocation does not hang when input is missing', async () => {
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['dist/cli/main.js'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => stdout += value);
    child.stderr.on('data', value => stderr += value);
    child.on('close', code => resolve({ code, output: stdout + stderr }));
  });
  assert.equal(result.code, 2);
  assert.match(result.output, /INTERACTIVE_INPUT_REQUIRED/);
  assert.match(result.output, /npx cf-tunnel ui/);
});
