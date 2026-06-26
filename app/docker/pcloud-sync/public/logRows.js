const FILE_LOG_EVENT_TYPES = new Set(['upload_succeeded', 'upload_failed']);

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
    status: meta.status,
    statusText: meta.statusText,
    eventText: meta.eventText,
    detail: event.message || ''
  };
}

function eventMeta(type) {
  const map = {
    upload_succeeded: { status: 'success', statusText: '成功', eventText: '上传' },
    upload_failed: { status: 'failed', statusText: '失败', eventText: '上传' }
  };
  return map[type] || { status: 'queued', statusText: '待处理', eventText: type || '事件' };
}

function taskForFile(fileName) {
  const first = String(fileName).split('/').filter(Boolean)[0];
  return first || 'sync';
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
