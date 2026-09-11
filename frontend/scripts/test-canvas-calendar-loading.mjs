import assert from 'node:assert/strict';
import { getCanvasCalendarLoadState } from '../src/lib/canvasCalendarLoading.ts';
import { shouldPromptForCanvasToken } from '../src/lib/canvasOnboarding.ts';

// Reproduce the race: a month request starts before the missing-token response
// cancels it, leaving the page cache in loading state with no remaining timeout.
assert.deepEqual(getCanvasCalendarLoadState(true, null), { shouldLoad: true, status: 'loading' });
const missingToken = { status: 'needs_connection', connected: false };
for (const remindersEnabled of [true, false]) {
  for (const dismissed of [true, false]) {
    assert.equal(shouldPromptForCanvasToken(missingToken, remindersEnabled, dismissed), remindersEnabled && !dismissed);
    for (const cachedStatus of [undefined, 'loading', 'failed', 'loaded']) {
      assert.deepEqual(getCanvasCalendarLoadState(true, missingToken, cachedStatus),
        { shouldLoad: false, status: 'idle' }, 'No Canvas wait, regardless of reminders or cached request state');
    }
  }
}

assert.deepEqual(getCanvasCalendarLoadState(true, { status: 'manual_mode' }, 'loading'),
  { shouldLoad: false, status: 'idle' }, 'Switching to manual mode releases a cancelled request overlay');
assert.deepEqual(getCanvasCalendarLoadState(false, { status: 'connected' }, 'loading'),
  { shouldLoad: false, status: 'idle' }, 'Switching to a local-only term releases the overlay');

// Connecting after skipping setup must re-enable both initial and refresh loads.
for (const status of ['connected', 'pending', 'expired', 'invalid']) {
  assert.deepEqual(getCanvasCalendarLoadState(true, { status }, 'loading'),
    { shouldLoad: true, status: 'loading' });
  assert.deepEqual(getCanvasCalendarLoadState(true, { status }, 'failed'),
    { shouldLoad: true, status: 'failed' }, 'Existing credentials retain retry and error handling');
}
assert.deepEqual(getCanvasCalendarLoadState(true, { status: 'connected' }, 'loaded'),
  { shouldLoad: true, status: 'loaded' });
assert.deepEqual(getCanvasCalendarLoadState(true, null, 'failed'),
  { shouldLoad: true, status: 'failed' }, 'A token-status outage must not conceal a calendar error');

console.log('Canvas calendar loading regression checks passed.');
