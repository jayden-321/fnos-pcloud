import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResticIndexCatalog } from '../src/restic/indexCatalog.js';
import { SqliteStore } from '../src/store/sqliteStore.js';

test('encrypted cloud index restores a snapshot directory into an empty local cache', async () => {
  const remote = new Map();
  const client = {
    ensureFolder: async (remotePath) => ({ folderid: remotePath }),
    uploadFile: async ({ filePath, filename, folderid }) => {
      remote.set(`${folderid}/${filename}`, await readFile(filePath));
      return {};
    },
    downloadFile: async ({ path: remotePath, filePath }) => {
      const body = remote.get(remotePath);
      if (!body) throw Object.assign(new Error('not found'), { result: 2005 });
      await writeFile(filePath, body);
      return { bytes: body.length };
    }
  };
  const task = {
    id: 'honvin', name: 'honvin', mode: 'restic', localPath: '/vol2/1000/honvin',
    remotePath: '/restic-backups/honvin'
  };
  const config = { pcloud: { accessToken: 'token' }, tasks: [task] };
  const snapshot = {
    id: 'abcdef1234567890', shortId: 'abcdef12', time: '2026-07-19T00:00:00Z',
    hostname: 'fnos', paths: [task.localPath], tags: ['task:honvin']
  };
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'restic-index-source-'));
  const sourceStore = new SqliteStore(sourceDir);
  await sourceStore.init();
  await sourceStore.saveConfig(config);
  await savePassword(sourceDir, task.id, 'test-restic-password');
  const sourceCatalog = new ResticIndexCatalog({ store: sourceStore, dataDir: sourceDir, pcloudFactory: () => client });
  const lines = [
    { struct_type: 'snapshot', id: snapshot.id },
    { struct_type: 'node', path: task.localPath, name: 'honvin', type: 'dir' },
    { struct_type: 'node', path: `${task.localPath}/公司`, name: '公司', type: 'dir', mtime: '2026-07-19T00:00:00Z' },
    { struct_type: 'node', path: `${task.localPath}/公司/合同.txt`, name: '合同.txt', type: 'file', size: 123, mtime: '2026-07-19T00:00:00Z' }
  ];
  await sourceCatalog.buildLocal(task, snapshot, lines);
  await sourceCatalog.publish(task, snapshot.id, config);

  const catalogRemotePath = '/restic-backups/.pcloud-nas-sync-index/honvin/catalog.json';
  assert.ok(remote.has(catalogRemotePath));
  assert.doesNotMatch(remote.get(catalogRemotePath).toString('utf8'), /合同|公司/);
  assert.doesNotMatch(remote.get(catalogRemotePath).toString('utf8'), /"paths"|"hostname"|"tags"|\/vol2\/1000/);
  const encrypted = [...remote.entries()].find(([name]) => name.endsWith('.index.ndjson.gz.enc'))?.[1];
  assert.ok(encrypted);
  assert.doesNotMatch(encrypted.toString('utf8'), /合同|公司/);

  const targetDir = await mkdtemp(path.join(tmpdir(), 'restic-index-target-'));
  const targetStore = new SqliteStore(targetDir);
  await targetStore.init();
  await targetStore.saveConfig(config);
  await savePassword(targetDir, task.id, 'test-restic-password');
  const targetCatalog = new ResticIndexCatalog({ store: targetStore, dataDir: targetDir, pcloudFactory: () => client });

  const result = await targetCatalog.reconcile(task, config);
  const root = await targetStore.browseResticSnapshotIndex(task.id, snapshot.id, '');
  const company = await targetStore.browseResticSnapshotIndex(task.id, snapshot.id, '公司');

  assert.deepEqual(result, { status: 'downloaded', snapshotId: snapshot.id });
  assert.deepEqual(root.map((entry) => [entry.name, entry.type]), [['公司', 'folder']]);
  assert.deepEqual(company.map((entry) => [entry.name, entry.type, entry.size]), [['合同.txt', 'file', 123]]);
  assert.equal((await targetStore.getResticIndexState(task.id)).status, 'ready');
});

async function savePassword(dataDir, taskId, password) {
  const directory = path.join(dataDir, 'restic', 'secrets');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${taskId}.password`), `${password}\n`, { mode: 0o600 });
}
