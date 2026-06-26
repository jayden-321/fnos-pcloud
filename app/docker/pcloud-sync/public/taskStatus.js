export function taskStatusText({ queue = null, stats = {}, counts = {} } = {}) {
  const queueStatus = queueStatusText(queue?.status);
  if (queueStatus) {
    return queueStatus;
  }
  if (Number(counts.failed || 0) > 0 || Number(counts.pending || 0) > 0 || Number(counts.uploading || 0) > 0) {
    return '同步中';
  }
  return Number(stats.total || 0) > 0 ? '同步完成' : '未扫描';
}

function queueStatusText(status) {
  return {
    queued: '同步中',
    running: '同步中',
    scanning: '扫描中',
    syncing: '同步中',
    pending: '同步中',
    completed: '同步完成',
    failed: '同步中',
    stopped: '同步中'
  }[status] || '';
}
