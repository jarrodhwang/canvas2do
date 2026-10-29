import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { canvasToDoApi } = await server.ssrLoadModule('/src/api/canvasToDoApi.ts');
  const pending = [];
  globalThis.window = {
    fetch: (url, init) => new Promise((resolve) => pending.push({ url, init, resolve })),
    dispatchEvent() {},
  };
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  const preferences = (id) => ({ manualLectures: [{ id }], canvasCourseworkPreferences: {}, canvasAssessmentPreferences: {}, calendarSettings: {} });

  canvasToDoApi.setAcademyPreferenceOwnerKey('user:first');
  const first = canvasToDoApi.getAcademyPreferences();
  const shared = canvasToDoApi.getAcademyPreferences();
  assert.equal(pending.length, 1, 'Concurrent preference reads share one network request');
  pending.shift().resolve(response(preferences('initial')));
  assert.equal((await first).manualLectures[0].id, 'initial');
  assert.equal((await shared).manualLectures[0].id, 'initial');

  const staleRead = canvasToDoApi.getAcademyPreferences();
  const save = canvasToDoApi.saveAcademyPreferences({ manualLectures: [{ id: 'new' }] });
  const duringSave = canvasToDoApi.getAcademyPreferences();
  assert.equal(pending.length, 3, 'A save prevents joining an earlier read');
  const oldRequest = pending.shift();
  pending.shift().resolve(response(preferences('new')));
  await save;
  pending.shift().resolve(response(preferences('during-save')));
  await duringSave;
  oldRequest.resolve(response(preferences('old')));
  await staleRead;
  const fresh = canvasToDoApi.getAcademyPreferences();
  assert.equal(pending.length, 1, 'Reads after saving are not cached');
  pending.shift().resolve(response(preferences('new')));
  assert.equal((await fresh).manualLectures[0].id, 'new');

  const previousOwner = canvasToDoApi.getAcademyPreferences();
  canvasToDoApi.setAcademyPreferenceOwnerKey('user:second');
  const nextOwner = canvasToDoApi.getAcademyPreferences();
  assert.equal(pending.length, 2, 'Account changes cannot share in-flight reads');
  pending.shift().resolve(response(preferences('first')));
  await assert.rejects(previousOwner, /account changed/i);
  pending.shift().resolve(response(preferences('second')));
  assert.equal((await nextOwner).manualLectures[0].id, 'second');

  const failed = canvasToDoApi.getAcademyPreferences();
  pending.shift().resolve(response({ detail: 'temporary failure' }, 500));
  await assert.rejects(failed);
  const retry = canvasToDoApi.getAcademyPreferences();
  assert.equal(pending.length, 1, 'A failed read can be retried');
  pending.shift().resolve(response(preferences('retry')));
  await retry;
  console.log('PASS concurrent preferences reads, save invalidation, account isolation and retry');
} finally {
  await server.close();
}
