import assert from 'node:assert/strict';
import { shouldPromptForCanvasToken, canvasSettingsUrl, canvasSchoolLogo } from '../src/lib/canvasOnboarding.ts';

for (const status of ['needs_connection', 'expired', 'invalid']) {
  assert.equal(shouldPromptForCanvasToken({ status, connected: false }, true, false), true, status);
  assert.equal(shouldPromptForCanvasToken({ status, connected: false }, false, false), status !== 'needs_connection', 'Opt-out hides setup nudges, authentication errors remain actionable');
  assert.equal(shouldPromptForCanvasToken({ status, connected: false }, true, true), false, 'Dismissal lasts this session');
}
assert.equal(shouldPromptForCanvasToken(null, true, false), false, 'Unknown status must not prompt');
assert.equal(shouldPromptForCanvasToken({ status: 'pending', connected: false }, true, false), false, 'Future token is already registered');
assert.equal(shouldPromptForCanvasToken({ status: 'connected', connected: true }, true, false), false);
assert.equal(canvasSettingsUrl(' https://school.instructure.com/courses/12 '), 'https://school.instructure.com/profile/settings');
for (const value of ['javascript:alert(1)', 'http://school.example', 'https://user:secret@school.example', '', 'bad-url']) {
  assert.equal(canvasSettingsUrl(value), null);
}
assert.equal(canvasSchoolLogo({ 'ic-brand-header-image': '/school.png' }, 'https://school.example'), 'https://school.example/school.png');
assert.equal(canvasSchoolLogo({ 'ic-brand-header-image': 'javascript:alert(1)' }, 'https://school.example'), '');
assert.equal(canvasSchoolLogo({ 'ic-brand-header-image': 'http://school.example/logo.png' }, 'https://school.example'), '');
assert.equal(canvasSchoolLogo({ 'ic-brand-header-image': 'https://secret@school.example/logo.png' }, 'https://school.example'), '');
assert.equal(canvasSchoolLogo(null, 'https://school.example'), '');
assert.equal(canvasSchoolLogo({ 'ic-brand-mobile-global-nav-logo': '', 'ic-brand-header-image': 'https://cdn.example/logo.png' }, 'https://school.example'), 'https://cdn.example/logo.png');
console.log('Canvas onboarding behavior and URL safety checks passed.');
