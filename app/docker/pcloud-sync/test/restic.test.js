import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResticService } from '../src/restic/service.js';
import { SqliteStore } from '../src/store/sqliteStore.js';
import { createApp } from '../src/web/server.js';

async function fixture(runCommand, { ignorePatterns = ['custom.tmp'] } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'restic-service-data-'));
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'restic-service-source-'));
  const restoreRoot = await mkdtemp(path.join(tmpdir(), 'restic-service-restore-'));
  await writeFile(path.join(sourceRoot, 'hello.txt'), 'hello restic');
  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig({
    pcloud: { hostname: 'api.pcloud.com', accessToken: 'token' },
    sync: { ignorePatterns, timezone: 'Asia/Shanghai' },
    tasks: [{
      id: 'honvin', name: 'honvin', mode: 'restic', enabled: true,
      localPath: sourceRoot, remotePath: '/restic-backups/honvin',
      schedule: { type: 'manual' },
      restic: { keepDaily: 7, keepWeekly: 4, keepMonthly: 12, compression: 'auto' }
    }]
  });
  const backend = { repositoryUrl: (taskId) => `rest:http://127.0.0.1:18081/${taskId}/` };
  const service = new ResticService({ store, dataDir, restoreRoot, allowedRoots: [sourceRoot], runCommand, backend });
  await service.ensureDirectories();
  return { service, store, dataDir, sourceRoot, restoreRoot };
}

test('ResticService initializes a repository, reports backup progress, and applies retention', async () => {
  const calls = [];
  let probeCount = 0;
  const { service, dataDir } = await fixture(async (command, args, options) => {
    calls.push([command, args]);
    if (args.includes('snapshots') && probeCount++ === 0) return { code: 10, stdout: '', stderr: '' };
    if (args.includes('backup')) {
      options.onStdoutLine?.(JSON.stringify({
        message_type: 'status', seconds_elapsed: 5, seconds_remaining: 45,
        percent_done: 0.125, files_done: 1, total_files: 4, bytes_done: 5, total_bytes: 40,
        error_count: 0, current_files: ['alpha.txt']
      }));
      options.onStdoutLine?.(JSON.stringify({
        message_type: 'status', seconds_elapsed: 20, seconds_remaining: 20,
        percent_done: 0.5, files_done: 2, total_files: 4, bytes_done: 20, total_bytes: 40,
        error_count: 0, current_files: ['beta.txt']
      }));
      options.onStderrLine?.(JSON.stringify({
        message_type: 'error', item: 'broken.txt', during: 'archival', error: { message: 'read failed' }
      }));
      options.onStdoutLine?.(JSON.stringify({ message_type: 'summary', snapshot_id: 'abcdef123456' }));
    }
    return { code: 0, stdout: '[]', stderr: '' };
  });

  await service.setPassword('honvin', 'a-strong-test-password');
  const started = await service.startBackup('honvin');
  const finished = await service.waitForIdle();

  assert.equal(started.active, true);
  assert.equal(finished.active, false);
  assert.equal(finished.percent, 50);
  assert.equal(finished.secondsElapsed, 20);
  assert.equal(finished.secondsRemaining, 20);
  assert.equal(finished.bytesPerSecond, 1);
  assert.equal(finished.averageBytesPerSecond, 1);
  assert.deepEqual(finished.currentFiles, ['beta.txt']);
  assert.deepEqual(finished.recentFiles, ['beta.txt', 'alpha.txt']);
  assert.equal(finished.errorCount, 1);
  assert.deepEqual(finished.recentErrors.map((item) => [item.item, item.message]), [['broken.txt', 'read failed']]);
  assert.equal(finished.phase, 'retention');
  assert.equal(finished.snapshotId, 'abcdef123456');
  assert.equal((await readFile(path.join(dataDir, 'restic', 'secrets', 'honvin.password'), 'utf8')).trim(), 'a-strong-test-password');
  assert.ok(calls.some(([, args]) => args.includes('init')));
  assert.ok(calls.some(([, args]) => args.includes('backup') && args.includes('custom.tmp')));
  assert.ok(calls.some(([, args]) => args.includes('forget') && args.includes('--keep-monthly')));
});

test('ResticService backs up honvin without any exclude arguments by default', async () => {
  const calls = [];
  const { service, sourceRoot } = await fixture(async (command, args) => {
    calls.push([command, args]);
    return args.includes('snapshots')
      ? { code: 0, stdout: '[]', stderr: '' }
      : { code: 0, stdout: '', stderr: '' };
  }, { ignorePatterns: [] });
  await service.setPassword('honvin', 'a-strong-test-password');

  await service.startBackup('honvin');
  await service.waitForIdle();

  const backupArgs = calls.find(([command, args]) => command === 'restic' && args.includes('backup'))?.[1];
  assert.ok(backupArgs);
  const backupIndex = backupArgs.indexOf('backup');
  assert.deepEqual(backupArgs.slice(backupIndex, backupIndex + 2), ['backup', sourceRoot]);
  assert.equal(backupArgs.includes('--exclude'), false);
});

test('ResticService turns only explicit ignore patterns into exclude arguments', async () => {
  const calls = [];
  const { service } = await fixture(async (command, args) => {
    calls.push([command, args]);
    return args.includes('snapshots')
      ? { code: 0, stdout: '[]', stderr: '' }
      : { code: 0, stdout: '', stderr: '' };
  }, { ignorePatterns: ['*.tmp', 'cache/**', '*.tmp'] });
  await service.setPassword('honvin', 'a-strong-test-password');

  await service.startBackup('honvin');
  await service.waitForIdle();

  const backupArgs = calls.find(([command, args]) => command === 'restic' && args.includes('backup'))?.[1];
  const excludes = backupArgs.flatMap((value, index) => value === '--exclude' ? [backupArgs[index + 1]] : []);
  assert.deepEqual(excludes, ['*.tmp', 'cache/**']);
});

test('ResticService lists plaintext snapshot entries without recursive traversal', async () => {
  const { service, sourceRoot } = await fixture(async (_command, args) => {
    if (args.includes('ls')) {
      const root = `/${sourceRoot.split('/').filter(Boolean).join('/')}`;
      return {
        code: 0,
        stderr: '',
        stdout: [
          JSON.stringify({ struct_type: 'snapshot', id: 'abcdef' }),
          JSON.stringify({ struct_type: 'node', path: root, name: path.basename(root), type: 'dir' }),
          JSON.stringify({ struct_type: 'node', path: `${root}/合同`, name: '合同', type: 'dir', mtime: '2026-07-19T00:00:00Z' }),
          JSON.stringify({ struct_type: 'node', path: `${root}/卖房.xlsx`, name: '卖房.xlsx', type: 'file', size: 123 })
        ].join('\n')
      };
    }
    return { code: 0, stdout: '[]', stderr: '' };
  });
  await service.setPassword('honvin', 'a-strong-test-password');

  const result = await service.browse('honvin', 'abcdef', '');

  assert.deepEqual(result.entries.map((entry) => [entry.name, entry.type, entry.path]), [
    ['合同', 'folder', '合同'],
    ['卖房.xlsx', 'file', '卖房.xlsx']
  ]);
});

test('ResticService serves cached snapshots and folders without invoking Restic', async () => {
  let commands = 0;
  const { service, store } = await fixture(async () => {
    commands += 1;
    return { code: 0, stdout: '[]', stderr: '' };
  });
  const snapshot = { id: 'abcdef123456', shortId: 'abcdef12', time: '2026-07-19T00:00:00Z', paths: [] };
  await store.beginResticIndexBuild('honvin', snapshot);
  await store.appendResticIndexEntries('honvin', snapshot.id, [
    { path: '公司', parent: '', name: '公司', type: 'folder', size: 0, mtime: '' },
    { path: '公司/合同.txt', parent: '公司', name: '合同.txt', type: 'file', size: 123, mtime: '' }
  ]);
  await store.finishResticIndexBuild('honvin', snapshot.id);

  const snapshots = await service.snapshots('honvin');
  const root = await service.browse('honvin', snapshot.id, '');

  assert.equal(commands, 0);
  assert.equal(snapshots[0].id, snapshot.id);
  assert.deepEqual(root.entries.map((entry) => [entry.name, entry.type]), [['公司', 'folder']]);
});

test('ResticService restores a selected file into an isolated download directory', async () => {
  const { service, sourceRoot } = await fixture(async (command, args) => {
    if (command === 'restic' && args.includes('restore')) {
      const target = args[args.indexOf('--target') + 1];
      const included = args[args.indexOf('--include') + 1];
      const restored = path.join(target, included.replace(/^\/+/, ''));
      await mkdir(path.dirname(restored), { recursive: true });
      await writeFile(restored, 'restored content');
    }
    return { code: 0, stdout: '', stderr: '' };
  });
  await service.setPassword('honvin', 'a-strong-test-password');

  const download = await service.prepareDownload('honvin', 'abcdef', 'hello.txt');

  assert.equal(download.filename, 'hello.txt');
  assert.equal(await readFile(download.filePath, 'utf8'), 'restored content');
  assert.match(download.filePath, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('ResticService creates folder ZIP downloads with UTF-8 filenames', async () => {
  const { service } = await fixture(async (command, args) => {
    if (command === 'restic' && args.includes('restore')) {
      const target = args[args.indexOf('--target') + 1];
      const included = args[args.indexOf('--include') + 1];
      const restored = path.join(target, included.replace(/^\/+/, ''), '合同.txt');
      await mkdir(path.dirname(restored), { recursive: true });
      await writeFile(restored, 'contract');
    }
    return { code: 0, stdout: '', stderr: '' };
  });
  await service.setPassword('honvin', 'a-strong-test-password');

  const download = await service.prepareDownload('honvin', 'abcdef', '子目录', { zip: true });
  const archive = await readFile(download.filePath);

  assert.equal(archive.readUInt16LE(6) & 0x0800, 0x0800);
  assert.ok(archive.includes(Buffer.from('子目录/合同.txt', 'utf8')));
});

test('ResticService does not auto-start a newly scheduled interval task', async () => {
  let commands = 0;
  const { service, store } = await fixture(async () => {
    commands += 1;
    return { code: 0, stdout: '', stderr: '' };
  });
  const config = await store.loadConfig();
  config.tasks[0].schedule = { type: 'interval', intervalSeconds: 300 };
  await store.saveConfig(config);
  await service.setPassword('honvin', 'a-strong-test-password');

  assert.equal(await service.runDueTasks(new Date('2026-07-19T00:00:00Z')), 0);
  assert.equal(commands, 0);
});

test('HTTP API exposes Restic backup, snapshot browse, and restore operations', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'restic-api-data-'));
  const store = new SqliteStore(dataDir);
  await store.init();
  const calls = [];
  const restic = {
    getStatus: () => ({ active: false }),
    taskStatuses: async () => [{ taskId: 'honvin', passwordConfigured: true }],
    startBackup: async (taskId) => { calls.push(['backup', taskId]); return { active: true, taskId }; },
    snapshots: async (taskId) => { calls.push(['snapshots', taskId]); return [{ id: 'abcdef', shortId: 'abcdef' }]; },
    browse: async (...args) => { calls.push(['browse', ...args]); return { path: '', entries: [{ name: '公司', type: 'folder' }] }; },
    restoreToNas: async (...args) => { calls.push(['restore', ...args]); return { destination: '/restore/honvin-test' }; }
  };
  const app = createApp({ store, engine: {}, restic });

  const backup = await app.fetch(new Request('http://local/api/restic/backup', { method: 'POST', body: JSON.stringify({ taskId: 'honvin' }) }));
  const snapshots = await app.fetch(new Request('http://local/api/restic/snapshots?taskId=honvin'));
  const browse = await app.fetch(new Request('http://local/api/restic/browse?taskId=honvin&snapshot=abcdef&path='));
  const restore = await app.fetch(new Request('http://local/api/restic/restore', { method: 'POST', body: JSON.stringify({ taskId: 'honvin', snapshot: 'abcdef', path: '公司' }) }));

  assert.equal(backup.status, 202);
  assert.deepEqual(await snapshots.json(), { snapshots: [{ id: 'abcdef', shortId: 'abcdef' }] });
  assert.deepEqual(await browse.json(), { path: '', entries: [{ name: '公司', type: 'folder' }] });
  assert.deepEqual(await restore.json(), { destination: '/restore/honvin-test' });
  assert.deepEqual(calls, [
    ['backup', 'honvin'],
    ['snapshots', 'honvin'],
    ['browse', 'honvin', 'abcdef', ''],
    ['restore', 'honvin', 'abcdef', '公司']
  ]);
});
