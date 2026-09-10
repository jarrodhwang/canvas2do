import assert from 'node:assert/strict';
import { getCanvasItemId, normalizeCanvasItemPreferences } from '../src/lib/canvasItemIdentity.ts';

const legacy = { courseId: '1', assignmentId: '42', title: 'Resume', completed: true, starred: true };
assert.equal(getCanvasItemId('canvas-assignment-assignment_42', legacy), 'canvas-assignment-1-42');
assert.equal(getCanvasItemId('canvas-assignment-assignment_42', { courseId: '1' }), 'canvas-assignment-1-42');
assert.equal(getCanvasItemId('old-event', { htmlUrl: 'https://canvas.example/courses/1/assignments/42' }), 'canvas-assignment-1-42');
assert.equal(getCanvasItemId('canvas-event-42', { courseId: '1', title: 'Resume' }), 'canvas-event-42');
const normalized = normalizeCanvasItemPreferences({
  'canvas-assignment-1-42': { ...legacy, title: 'Edited resume', completed: false, starred: false },
  'canvas-assignment-assignment_42': legacy,
  'canvas-assignment-2-42': { ...legacy, courseId: '2' },
  'canvas-assignment-1-43': { ...legacy, assignmentId: '43' },
});
assert.equal(Object.keys(normalized).length, 3, 'same titles in distinct assignments/courses remain separate');
assert.equal(normalized['canvas-assignment-1-42'].title, 'Edited resume');
assert.equal(normalized['canvas-assignment-1-42'].completed, true);
assert.equal(normalized['canvas-assignment-1-42'].starred, true);
assert.deepEqual(normalizeCanvasItemPreferences(normalized), normalized, 'migration is idempotent');
console.log('PASS Canvas assignment identity and saved preference migration');
