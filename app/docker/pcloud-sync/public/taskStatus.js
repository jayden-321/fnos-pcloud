export function taskStatusText({ queue = null, stats = {}, counts = {} } = {}) {
  if (queue?.status === 'scanning') {
    return '扫描中';
  }
  if (hasActiveWork(stats, counts)) {
    return '同步中';
  }
  if (isComplete(stats)) {
    return '同步完成';
  }
  const queueStatus = queueStatusText(queue?.status);
  if (queueStatus) {
    return queueStatus;
  }
  return Number(stats.total || 0) > 0 ? '同步完成' : '未扫描';
}

function hasActiveWork(stats, counts) {
  return ['failed', 'pending', 'uploading'].some((key) => (
    Number(counts[key] || 0) > 0 || Number(stats[key] || 0) > 0
  ));
}

function isComplete(stats) {
  const total = Number(stats.total || 0);
  return total > 0 && Number(stats.synced || 0) + Number(stats.existing || 0) >= total;
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
