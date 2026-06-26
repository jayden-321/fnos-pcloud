import test from 'node:test';
import assert from 'node:assert/strict';
import { eventToLogRow, fileLogEvents } from '../public/logRows.js';

test('sync log source keeps per-file upload events only', () => {
  const events = [
    { type: 'scan_completed', subject: 'sync', message: '6 discovered, 6 uploaded, 0 failed' },
    { type: 'retry_queued', subject: 'failed files', message: '1 files queued' },
    { type: 'upload_succeeded', subject: 'MACOS/a.txt', message: '/Sync/MACOS/a.txt' },
    { type: 'upload_failed', subject: 'MACOS/b.txt', message: 'socket hang up' }
  ];

  assert.deepEqual(fileLogEvents(events).map((event) => event.type), ['upload_succeeded', 'upload_failed']);
});

test('sync log row maps one file event to table columns', () => {
  const row = eventToLogRow({
    type: 'upload_failed',
    subject: 'MACOS/MK-unlocker/backup/vmwarebase.dll',
    message: 'socket hang up',
    at: '2026-06-26T11:02:40.000Z'
  });

  assert.equal(row.fileName, 'MACOS/MK-unlocker/backup/vmwarebase.dll');
  assert.equal(row.task, 'MACOS');
  assert.equal(row.status, 'failed');
  assert.equal(row.statusText, '失败');
  assert.equal(row.eventText, '上传');
  assert.equal(row.detail, 'socket hang up');
  assert.match(row.time, /^2026-06-26 \d{2}:02:40$/);
});
