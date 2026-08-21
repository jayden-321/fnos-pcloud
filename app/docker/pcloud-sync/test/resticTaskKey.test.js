import test from 'node:test';
import assert from 'node:assert/strict';
import { resticTaskKey } from '../src/restic/taskKey.js';

test('Restic task storage keys preserve existing ASCII ids and distinguish Chinese ids', () => {
  assert.equal(resticTaskKey('honvin-formal'), 'honvin-formal');
  assert.match(resticTaskKey('永久存档'), /^restic-task-[a-f0-9]{12}$/);
  assert.notEqual(resticTaskKey('永久存档'), resticTaskKey('公司存档'));
});
