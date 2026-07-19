import test from 'node:test';
import assert from 'node:assert/strict';
import { taskStatusText } from '../public/taskStatus.js';

test('taskStatusText shows the four primary task states', () => {
  assert.equal(taskStatusText({
    stats: { total: 0, synced: 0, existing: 0, failed: 0, pending: 0, uploading: 0 },
    counts: { failed: 0, pending: 0, uploading: 0 }
  }), '未扫描');

  assert.equal(taskStatusText({
    queue: { status: 'scanning' },
    stats: { total: 0 },
    counts: { failed: 0, pending: 0, uploading: 0 }
  }), '扫描中');

  assert.equal(taskStatusText({
    queue: { status: 'syncing' },
    stats: { total: 0 },
    counts: { failed: 0, pending: 0, uploading: 0 }
  }), '同步中');

  assert.equal(taskStatusText({
    stats: { total: 3, synced: 2, existing: 1, failed: 0, pending: 0, uploading: 0 },
    counts: { failed: 0, pending: 0, uploading: 0 }
  }), '同步完成');
});

test('taskStatusText treats pending, uploading, and failed files as syncing work', () => {
  for (const counts of [
    { failed: 0, pending: 1, uploading: 0 },
    { failed: 0, pending: 0, uploading: 1 },
    { failed: 1, pending: 0, uploading: 0 }
  ]) {
    assert.equal(taskStatusText({ stats: { total: 0 }, counts }), '同步中');
  }
});

test('taskStatusText treats a syncing queue with completed file stats as complete', () => {
  assert.equal(taskStatusText({
    queue: { status: 'syncing' },
    stats: { total: 57764, synced: 57764, existing: 0, failed: 0, pending: 0, uploading: 0 },
    counts: { failed: 0, pending: 0, uploading: 0 }
  }), '同步完成');
});
