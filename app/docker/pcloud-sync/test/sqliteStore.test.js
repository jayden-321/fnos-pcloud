import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../src/store/sqliteStore.js';

test('SqliteStore uses state.sqlite and does not create state.json', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-sqlite-store-'));
  await writeJson(path.join(dir, 'state.json'), {
    config: { pcloud: { accessToken: 'old-json-token' } },
    files: {
      'docs/old.txt': {
        key: 'docs/old.txt',
        sourceId: 'docs',
        status: 'existing',
        size: 1
      }
    },
    events: []
  });

  const store = new SqliteStore(dir);
  await store.init();

  assert.equal(await store.loadConfig(), null);
  assert.deepEqual(await store.listFiles(), []);
  assert.equal((await stat(path.join(dir, 'state.sqlite'))).isFile(), true);
});

test('SqliteStore persists per-task pCloud remote scan state', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-sqlite-remote-state-'));
  const store = new SqliteStore(dir);
  await store.init();

  await store.setTaskRemoteState('docs', {
    remotePath: '/Sync/docs',
    remoteFolderId: 42,
    diffid: 100,
    lastScanMode: 'remote_full',
    lastFullRemoteScanAt: '2026-06-26T10:00:00.000Z'
  });
  await store.setTaskRemoteState('docs', {
    diffid: 101,
    lastScanMode: 'remote_diff'
  });

  const state = await store.getTaskRemoteState('docs');
  const states = await store.listTaskRemoteStates();

  assert.equal(state.taskId, 'docs');
  assert.equal(state.remotePath, '/Sync/docs');
  assert.equal(state.remoteFolderId, 42);
  assert.equal(state.diffid, 101);
  assert.equal(state.lastScanMode, 'remote_diff');
  assert.equal(state.lastFullRemoteScanAt, '2026-06-26T10:00:00.000Z');
  assert.deepEqual(states.map((item) => item.taskId), ['docs']);
});

test('SqliteStore persists config, files, and events in SQLite', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-sqlite-store-persist-'));
  const store = new SqliteStore(dir);
  await store.init();

  await store.saveConfig({ port: 8080, tasks: [{ id: 'docs', name: 'Docs' }] });
  await store.upsertFile({ key: 'docs/a.txt', sourceId: 'docs', status: 'synced', size: 12 });
  await store.upsertFile({ key: 'docs/b.txt', sourceId: 'docs', status: 'existing', size: 8 });
  await store.addEvent('upload_succeeded', 'docs/a.txt', '/Sync/docs/a.txt', { size: 12 });

  const reloaded = new SqliteStore(dir);
  await reloaded.init();

  assert.equal((await reloaded.loadConfig()).port, 8080);
  assert.deepEqual(await reloaded.stats({ sourceId: 'docs' }), {
    total: 2,
    synced: 1,
    existing: 1,
    failed: 0,
    pending: 0,
    uploading: 0,
    bytesSynced: 12
  });
  assert.deepEqual((await reloaded.listEvents()).map((event) => [event.type, event.subject, event.size]), [
    ['upload_succeeded', 'docs/a.txt', 12]
  ]);
});

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
