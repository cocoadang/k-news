import test from 'node:test';
import assert from 'node:assert/strict';
import { startVisiblePolling } from './screenPolling';

test('visible screen refreshes each minute, pauses hidden, resumes immediately, and cleans up', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  let calls = 0;
  const stop = startVisiblePolling(() => { calls++; }, visibility);
  assert.equal(calls, 1);
  t.mock.timers.tick(59_999); assert.equal(calls, 1);
  t.mock.timers.tick(1); assert.equal(calls, 2);
  visibility.hidden = true; visibility.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(600_000); assert.equal(calls, 2);
  visibility.hidden = false; visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 3);
  t.mock.timers.tick(60_000); assert.equal(calls, 4);
  stop();
  visibility.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(60_000); assert.equal(calls, 4);
});

test('a screen mounted in a hidden tab waits until it becomes visible', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const visibility = Object.assign(new EventTarget(), { hidden: true });
  let calls = 0;
  const stop = startVisiblePolling(() => { calls++; }, visibility);
  t.mock.timers.tick(600_000); assert.equal(calls, 0);
  visibility.hidden = false; visibility.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls, 1);
  stop();
});
