import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityFeed, ConnectorWatchdog } from '../dist/index.js';

function harness({ autoRestartOnCrash = true, maxRestartAttempts = 2, startResult = { state: 'succeeded' } } = {}) {
  let listener; const timers = []; const starts = []; const feed = new ActivityFeed();
  const watchdog = new ConnectorWatchdog({
    onExit: fn => { listener = fn; return () => { listener = undefined; }; },
    projectIdForKey: key => key === 'quick:p1' ? 'p1' : undefined,
    projectName: () => 'Shop',
    start: async id => { starts.push(id); return typeof startResult === 'function' ? startResult() : startResult; },
    settings: () => ({ autoRestartOnCrash, maxRestartAttempts, notifyOnDisconnect: true }),
    feed, log: () => undefined,
    setTimer: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimer: () => undefined, now: () => 1_000,
  });
  return { exit: exit => listener?.(exit), timers, starts, feed, watchdog };
}

test('ignores requested stops and restarts unexpected exits with backoff', async () => {
  const h = harness();
  h.exit({ key: 'quick:p1', state: 'stopped', code: 0, expected: true });
  assert.equal(h.timers.length, 0);
  h.exit({ key: 'quick:p1', state: 'failed', code: 1, expected: false });
  assert.equal(h.timers[0].ms, 5_000);
  await h.timers[0].callback();
  assert.deepEqual(h.starts, ['p1']);
  h.exit({ key: 'quick:p1', state: 'failed', code: 1, expected: false });
  assert.equal(h.timers[1].ms, 15_000);
  const types = h.feed.list().events.map(event => event.type);
  assert.deepEqual(types, ['connector-failed', 'connector-restarted', 'connector-failed']);
});

test('gives up after the configured attempts and respects the off switch', async () => {
  const h = harness({ startResult: { state: 'failed', error: { reason: 'origin down' } } });
  h.exit({ key: 'quick:p1', state: 'failed', code: 1, expected: false });
  await h.timers[0].callback();
  await h.timers[1].callback();
  assert.equal(h.timers.length, 2);
  assert.equal(h.feed.list().events.at(-1).type, 'connector-gave-up');
  const off = harness({ autoRestartOnCrash: false });
  off.exit({ key: 'quick:p1', state: 'failed', code: 1, expected: false });
  assert.equal(off.timers.length, 0);
  assert.match(off.feed.list().events[0].message, /Automatic restart is off/);
});
