export function createResticBrowserState() {
  return {
    taskId: '',
    snapshot: '',
    path: '',
    parent: null,
    entries: [],
    snapshots: [],
    indexSnapshotId: '',
    snapshotRequestId: 0,
    folderRequestId: 0
  };
}

export function selectResticTask(state, taskId) {
  const nextTaskId = String(taskId || '');
  if (state.taskId === nextTaskId) return false;
  Object.assign(state, {
    taskId: nextTaskId,
    snapshot: '',
    path: '',
    parent: null,
    entries: [],
    snapshots: [],
    indexSnapshotId: '',
    snapshotRequestId: state.snapshotRequestId + 1,
    folderRequestId: state.folderRequestId + 1
  });
  return true;
}

export function beginResticSnapshotRequest(state) {
  return {
    requestId: ++state.snapshotRequestId,
    taskId: state.taskId
  };
}

export function isCurrentResticSnapshotRequest(state, request) {
  return Boolean(request.taskId)
    && request.taskId === state.taskId
    && request.requestId === state.snapshotRequestId;
}

export function beginResticFolderRequest(state, relativePath = '') {
  return {
    requestId: ++state.folderRequestId,
    taskId: state.taskId,
    snapshot: state.snapshot,
    path: String(relativePath || '')
  };
}

export function isCurrentResticFolderRequest(state, request) {
  return Boolean(request.taskId && request.snapshot)
    && request.taskId === state.taskId
    && request.snapshot === state.snapshot
    && request.requestId === state.folderRequestId;
}
