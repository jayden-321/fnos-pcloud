import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store/jsonStore.js';

test('JsonStore persists config and file records with aggregate stats', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-'));
  const store = new JsonStore(dir);
  await store.init();

  await store.saveConfig({ port: 8080, sources: [] });
  await store.upsertFile({ key: 'photos/a.jpg', status: 'synced', size: 12 });
  await store.upsertFile({ key: 'photos/b.jpg', status: 'failed', size: 8, error: 'quota' });
  await store.addEvent('upload_failed', 'photos/b.jpg', 'quota');

  assert.deepEqual(await store.stats(), {
    total: 2,
    synced: 1,
    failed: 1,
    pending: 0,
    uploading: 0,
    bytesSynced: 12
  });

  const reloaded = new JsonStore(dir);
  await reloaded.init();
  assert.equal((await reloaded.loadConfig()).port, 8080);
  assert.equal((await reloaded.listFiles()).length, 2);
  assert.equal((await reloaded.listEvents()).length, 1);

  const disk = JSON.parse(await readFile(path.join(dir, 'state.json'), 'utf8'));
  assert.equal(disk.files['photos/b.jpg'].error, 'quota');
});

test('JsonStore serializes concurrent saves without tmp-file races', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-store-concurrent-'));
  const store = new JsonStore(dir);
  await store.init();

  await Promise.all(Array.from({ length: 50 }, (_, index) => store.upsertFile({
    key: `batch/file-${index}.txt`,
    status: 'pending',
    size: index
  })));

  const reloaded = new JsonStore(dir);
  await reloaded.init();
  assert.equal((await reloaded.listFiles()).length, 50);
});
