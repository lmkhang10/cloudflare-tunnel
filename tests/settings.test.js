import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, resolveSettings, validateSettingsPatch, settingDefinitions } from '../dist/index.js';

test('fills defaults and ignores unknown or invalid stored values', () => {
  const settings = resolveSettings({ trayEnabled: false, protocol: 'carrier-pigeon', unknown: 1, maxRestartAttempts: 3 });
  assert.equal(settings.trayEnabled, false);
  assert.equal(settings.protocol, defaultSettings.protocol);
  assert.equal(settings.maxRestartAttempts, 3);
  assert.equal('unknown' in settings, false);
});

test('validates and coerces patches from the CLI and UI', () => {
  assert.deepEqual(validateSettingsPatch({ autoRestartOnCrash: 'false', uiPort: '8787', protocol: 'http2' }), { autoRestartOnCrash: false, uiPort: 8787, protocol: 'http2' });
  assert.throws(() => validateSettingsPatch({ uiPort: 70000 }), /0 to 65535/);
  assert.throws(() => validateSettingsPatch({ protocol: 'udp' }), /auto, quic, http2/);
  assert.throws(() => validateSettingsPatch({ nope: true }), /Unknown setting/);
  assert.throws(() => validateSettingsPatch({ cloudflaredPath: 'a\nb' }), /Invalid value/);
});

test('every setting has a label and a UI group', () => {
  for (const definition of settingDefinitions) {
    assert.ok(definition.label, definition.key);
    assert.ok(['general', 'tunnels', 'cloudflared', 'notifications', 'updates'].includes(definition.group), definition.key);
  }
});
