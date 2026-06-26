const FILE_LOG_EVENT_TYPES = new Set(['upload_succeeded', 'upload_verified_after_error', 'upload_failed']);

export function fileLogEvents(events = []) {
  return events.filter((event) => FILE_LOG_EVENT_TYPES.has(event?.type));
}

export function eventToLogRow(event) {
  const meta = eventMeta(event.type);
  const fileName = event.subject || '同步文件';
  return {
    fileName,
    task: taskForFile(fileName),
    time: formatDateTime(event.at),
    size: numberOrNull(event.size),
    sizeText: formatBytes(event.size),
    progressText: '',
    status: meta.status,
    statusText: meta.statusText,
    eventText: meta.eventText,
    detail: event.message || ''
  };
}

export function uploadToLogRow(file, activeUpload = {}) {
  const fileName = file?.key || activeUpload?.key || '同步文件';
  const bytes = numberOrNull(activeUpload?.bytes);
  const total = numberOrNull(activeUpload?.total) ?? numberOrNull(file?.size);
  return {
    fileName,
    task: taskForFile(fileName),
    time: formatDateTime(activeUpload?.updatedAt || file?.updatedAt),
    size: total,
    sizeText: formatBytes(total),
    progressText: formatProgress(bytes, total),
    status: 'uploading',
    statusText: '上传中',
    eventText: '上传',
    detail: ''
  };
}

function eventMeta(type) {
  const map = {
    upload_succeeded: { status: 'success', statusText: '成功', eventText: '上传' },
    upload_verified_after_error: { status: 'success', statusText: '成功', eventText: '校验' },
    upload_failed: { status: 'failed', statusText: '失败', eventText: '上传' }
  };
  return map[type] || { status: 'queued', statusText: '待处理', eventText: type || '事件' };
}

function taskForFile(fileName) {
  const first = String(fileName).split('/').filter(Boolean)[0];
  return first || 'sync';
}

function formatProgress(bytes, total) {
  if (bytes === null && total === null) {
    return '';
  }
  if (total && total > 0) {
    const uploaded = Math.max(0, bytes ?? 0);
    const percent = Math.max(0, Math.min(100, Math.round((uploaded / total) * 100)));
    return `${formatBytes(uploaded)} / ${formatBytes(total)} (${percent}%)`;
  }
  return bytes === null ? '' : formatBytes(bytes);
}

function formatBytes(value) {
  const bytes = numberOrNull(value);
  if (bytes === null) {
    return '';
  }
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
