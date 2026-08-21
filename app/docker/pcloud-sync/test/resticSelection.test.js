import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginResticFolderRequest,
  beginResticSnapshotRequest,
  createResticBrowserState,
  isCurrentResticFolderRequest,
  isCurrentResticSnapshotRequest,
  selectResticTask
} from '../public/resticSelection.js';

test('switching Restic tasks clears task-scoped details and rejects the old snapshot response', () => {
  const state = createResticBrowserState();
  selectResticTask(state, 'task-a');
  state.snapshot = 'snapshot-a';
  state.path = 'folder-a';
  state.parent = '';
  state.entries = [{ name: 'a.txt' }];
  state.snapshots = [{ id: 'snapshot-a' }];
  state.indexSnapshotId = 'snapshot-a';
  const taskARequest = beginResticSnapshotRequest(state);

  assert.equal(selectResticTask(state, 'task-b'), true);
  assert.equal(state.taskId, 'task-b');
  assert.equal(state.snapshot, '');
  assert.equal(state.path, '');
  assert.equal(state.parent, null);
  assert.deepEqual(state.entries, []);
  assert.deepEqual(state.snapshots, []);
  assert.equal(state.indexSnapshotId, '');
  assert.equal(isCurrentResticSnapshotRequest(state, taskARequest), false);
});

test('only the newest snapshot and folder requests may update the selected Restic task', () => {
  const state = createResticBrowserState();
  selectResticTask(state, 'task-b');

  const olderSnapshots = beginResticSnapshotRequest(state);
  const newerSnapshots = beginResticSnapshotRequest(state);
  assert.equal(isCurrentResticSnapshotRequest(state, olderSnapshots), false);
  assert.equal(isCurrentResticSnapshotRequest(state, newerSnapshots), true);

  state.snapshot = 'snapshot-b';
  const olderFolder = beginResticFolderRequest(state, 'old-folder');
  const newerFolder = beginResticFolderRequest(state, 'new-folder');
  assert.equal(isCurrentResticFolderRequest(state, olderFolder), false);
  assert.equal(isCurrentResticFolderRequest(state, newerFolder), true);

  selectResticTask(state, 'task-c');
  assert.equal(isCurrentResticFolderRequest(state, newerFolder), false);
});
