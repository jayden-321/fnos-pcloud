import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/store/sqliteStore.js';

test('SqliteStore persists config and file records with aggregate stats', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-'));
  const store = new SqliteStore(dir);
  await store.init();

  await store.saveConfig({ port: 8080, sources: [] });
  await store.upsertFile({ key: 'photos/a.jpg', status: 'synced', size: 12 });
  await store.upsertFile({ key: 'photos/b.jpg', status: 'failed', size: 8, error: 'quota' });
  await store.upsertFile({ key: 'photos/c.jpg', status: 'existing', size: 6 });
  await store.addEvent('upload_failed', 'photos/b.jpg', 'quota', { size: 8 });

  assert.deepEqual(await store.stats(), {
    total: 3,
    synced: 1,
    existing: 1,
    failed: 1,
    pending: 0,
    uploading: 0,
    bytesSynced: 12
  });

  const reloaded = new SqliteStore(dir);
  await reloaded.init();
  assert.equal((await reloaded.loadConfig()).port, 8080);
  assert.equal((await reloaded.listFiles()).length, 3);
  assert.equal((await reloaded.listEvents()).length, 1);
  assert.equal((await stat(path.join(dir, 'state.sqlite'))).isFile(), true);
});

test('SqliteStore clears file records for a fresh scan rebuild', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-clear-files-'));
  const store = new SqliteStore(dir);
  await store.init();

  await store.upsertFile({ key: 'old/a.txt', status: 'pending', size: 1 });
  await store.upsertFile({ key: 'old/b.txt', status: 'failed', size: 2 });

  assert.equal(await store.clearFiles(), 2);
  assert.deepEqual(await store.listFiles(), []);
  assert.deepEqual(await store.stats(), {
    total: 0,
    synced: 0,
    existing: 0,
    failed: 0,
    pending: 0,
    uploading: 0,
    bytesSynced: 0
  });
});

test('SqliteStore stats can be scoped to one task', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-task-stats-'));
  const store = new SqliteStore(dir);
  await store.init();

  await store.upsertFile({ key: 'docs/a.txt', sourceId: 'docs', status: 'synced', size: 10 });
  await store.upsertFile({ key: 'docs/b.txt', sourceId: 'docs', status: 'existing', size: 20 });
  await store.upsertFile({ key: 'pics/a.jpg', sourceId: 'pics', status: 'pending', size: 30 });

  assert.deepEqual(await store.stats({ sourceId: 'docs' }), {
    total: 2,
    synced: 1,
    existing: 1,
    failed: 0,
    pending: 0,
    uploading: 0,
    bytesSynced: 10
  });
});

test('SqliteStore replaces one task file set without deleting other tasks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-replace-source-'));
  const store = new SqliteStore(dir);
  await store.init();

  await store.upsertFile({ key: 'docs/old.txt', sourceId: 'docs', status: 'pending', size: 1 });
  await store.upsertFile({ key: 'pics/a.jpg', sourceId: 'pics', status: 'synced', size: 2 });

  assert.equal(await store.replaceFilesForSources(['docs'], [
    { key: 'docs/new.txt', sourceId: 'docs', status: 'synced', size: 3 }
  ]), 1);

  assert.deepEqual((await store.listFiles()).map((file) => [file.key, file.status]), [
    ['docs/new.txt', 'synced'],
    ['pics/a.jpg', 'synced']
  ]);
});

test('SqliteStore serializes concurrent saves without tmp-file races', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-concurrent-'));
  const store = new SqliteStore(dir);
  await store.init();

  await Promise.all(Array.from({ length: 50 }, (_, index) => store.upsertFile({
    key: `batch/file-${index}.txt`,
    status: 'pending',
    size: index
  })));

  const reloaded = new SqliteStore(dir);
  await reloaded.init();
  assert.equal((await reloaded.listFiles()).length, 50);
});

test('SqliteStore prunes and clears events using log retention config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-events-'));
  const store = new SqliteStore(dir);
  await store.init();
  await store.saveConfig({
    sync: { logRetentionDays: 0, logRetentionCount: 2 }
  });

  await store.addEvent('upload_succeeded', 'docs/a.txt', '');
  await store.addEvent('upload_succeeded', 'docs/b.txt', '');
  await store.addEvent('upload_succeeded', 'docs/c.txt', '');

  assert.deepEqual((await store.listEvents()).map((event) => event.subject), ['docs/c.txt', 'docs/b.txt']);
  assert.equal(await store.clearEvents(), 2);
  assert.deepEqual(await store.listEvents(), []);
});

test('SqliteStore prunes events older than the configured retention days', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-event-age-'));
  const store = new SqliteStore(dir);
  await store.init();
  await store.saveConfig({
    sync: { logRetentionDays: 1, logRetentionCount: 0 }
  });
  const newEvent = { type: 'upload_succeeded', subject: 'docs/new.txt', message: '', at: new Date().toISOString() };
  const oldEvent = { type: 'upload_succeeded', subject: 'docs/old.txt', message: '', at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() };
  store.db.prepare('INSERT INTO events (type, subject, message, at, data) VALUES (?, ?, ?, ?, ?)').run(
    newEvent.type,
    newEvent.subject,
    newEvent.message,
    newEvent.at,
    JSON.stringify(newEvent)
  );
  store.db.prepare('INSERT INTO events (type, subject, message, at, data) VALUES (?, ?, ?, ?, ?)').run(
    oldEvent.type,
    oldEvent.subject,
    oldEvent.message,
    oldEvent.at,
    JSON.stringify(oldEvent)
  );

  assert.equal(await store.pruneEvents(), 1);
  assert.deepEqual((await store.listEvents()).map((event) => event.subject), ['docs/new.txt']);
});
