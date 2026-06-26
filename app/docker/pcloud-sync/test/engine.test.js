import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config/config.js';
import { SqliteStore } from '../src/store/sqliteStore.js';
import { SyncEngine } from '../src/sync/engine.js';

test('SyncEngine scans configured sources and queues files when pCloud token is missing', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  await writeFile(path.join(sourceDir, 'a.txt'), 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    sources: [{ id: 'docs', path: sourceDir, enabled: true, remoteName: 'Docs' }]
  }));

  const engine = new SyncEngine({ store });
  const result = await engine.scanNow();

  assert.equal(result.discovered, 1);
  assert.equal(result.queued, 1);
  assert.equal(result.uploaded, 0);
  assert.equal((await store.stats()).pending, 1);
});

test('SyncEngine uploads pending files and records pCloud file ids', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  await writeFile(path.join(sourceDir, 'a.txt'), 'hello');
  const calls = [];

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    sources: [{ id: 'docs', path: sourceDir, enabled: true, remoteName: 'Docs' }]
  }));

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => new Map(),
      ensureFolder: async (remotePath) => {
        calls.push(['ensureFolder', remotePath]);
        return { folderid: 42 };
      },
      uploadFile: async (payload) => {
        calls.push(['uploadFile', payload.filename, payload.folderid]);
        return { fileids: [99], metadata: [{ fileid: 99, name: payload.filename }] };
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();
  const events = await store.listEvents();

  assert.equal(result.uploaded, 1);
  assert.equal((await store.stats()).synced, 1);
  assert.equal(files[0].pcloudFileId, 99);
  assert.ok(events.some((event) => event.type === 'upload_succeeded' && event.subject === 'docs/a.txt' && event.size === 5));
  assert.deepEqual(calls.map((call) => call[0]), ['ensureFolder', 'uploadFile']);
  assert.equal(calls[0][1], '/NAS/Docs');
});

test('SyncEngine uses cached file state on repeated scans instead of relisting remote files', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  await writeFile(path.join(sourceDir, 'a.txt'), 'hello');
  let remoteScans = 0;
  let uploads = 0;

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => {
        remoteScans += 1;
        return new Map();
      },
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        uploads += 1;
        return { fileids: [109], metadata: [{ fileid: 109, name: 'a.txt' }] };
      }
    })
  });

  assert.equal((await engine.scanNow()).uploaded, 1);
  assert.equal(remoteScans, 1);
  assert.equal(uploads, 1);

  const second = await engine.scanNow();
  const files = await store.listFiles();

  assert.equal(second.uploaded, 0);
  assert.equal(second.remoteFiles, 0);
  assert.equal(remoteScans, 1);
  assert.equal(uploads, 1);
  assert.equal(files[0].status, 'synced');
  assert.equal((await store.stats()).synced, 1);
});

test('SyncEngine preserves cached existing files when a repeated scan skips remote listing', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'a.txt');
  await writeFile(filePath, 'hello');
  const info = await stat(filePath);

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/a.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'a.txt',
    remotePath: '/Sync/docs/a.txt',
    size: 5,
    mtimeMs: Math.trunc(info.mtimeMs),
    mtime: Math.trunc(info.mtimeMs / 1000),
    status: 'existing',
    pcloudPath: '/Sync/docs/a.txt'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => {
        throw new Error('repeated scans should use cached existing metadata');
      },
      ensureFolder: async () => {
        throw new Error('existing files should not upload');
      },
      uploadFile: async () => {
        throw new Error('existing files should not upload');
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();
  const stats = await store.stats();

  assert.equal(result.uploaded, 0);
  assert.equal(result.remoteFiles, 0);
  assert.equal(result.existing, 1);
  assert.equal(files[0].status, 'existing');
  assert.equal(files[0].pcloudPath, '/Sync/docs/a.txt');
  assert.equal(stats.existing, 1);
  assert.equal(stats.synced, 0);
});

test('SyncEngine batches cached scan state writes instead of upserting each unchanged file', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const files = ['a.txt', 'b.txt'];

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));

  for (const filename of files) {
    const filePath = path.join(sourceDir, filename);
    await writeFile(filePath, filename);
    const info = await stat(filePath);
    await store.upsertFile({
      key: `docs/${filename}`,
      sourceId: 'docs',
      absolutePath: filePath,
      relativePath: filename,
      remotePath: `/Sync/docs/${filename}`,
      size: filename.length,
      mtimeMs: Math.trunc(info.mtimeMs),
      mtime: Math.trunc(info.mtimeMs / 1000),
      status: 'synced'
    });
  }

  store.upsertFile = async () => {
    throw new Error('cached scans should batch file state writes');
  };

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => {
        throw new Error('cached scans should not list remote files');
      },
      ensureFolder: async () => {
        throw new Error('unchanged files should not upload');
      },
      uploadFile: async () => {
        throw new Error('unchanged files should not upload');
      }
    })
  });

  const result = await engine.scanNow();
  const stats = await store.stats();

  assert.equal(result.uploaded, 0);
  assert.equal(result.unchanged, 2);
  assert.equal(stats.synced, 2);
});

test('SyncEngine runs task scan and upload jobs sequentially by task', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const firstDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-first-'));
  const secondDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-second-'));
  await writeFile(path.join(firstDir, 'a.txt'), 'first');
  await writeFile(path.join(secondDir, 'b.txt'), 'second');
  const calls = [];

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    sync: { concurrency: 1 },
    tasks: [
      { id: 'first', name: 'First', localPath: firstDir, remotePath: '/Sync/first', enabled: true },
      { id: 'second', name: 'Second', localPath: secondDir, remotePath: '/Sync/second', enabled: true }
    ]
  }));

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async (remotePath) => {
        calls.push(`scan:${remotePath}`);
        return new Map();
      },
      ensureFolder: async (remotePath) => {
        calls.push(`ensure:${remotePath}`);
        return { folderid: remotePath.endsWith('first') ? 1 : 2 };
      },
      uploadFile: async (payload) => {
        calls.push(`upload:${payload.filename}`);
        return { fileids: [payload.folderid], metadata: [{ fileid: payload.folderid, name: payload.filename }] };
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();

  assert.deepEqual(calls, [
    'scan:/Sync/first',
    'ensure:/Sync/first',
    'upload:a.txt',
    'scan:/Sync/second',
    'ensure:/Sync/second',
    'upload:b.txt'
  ]);
  assert.deepEqual(result.taskResults.map((task) => [task.id, task.status, task.uploaded]), [
    ['first', 'completed', 1],
    ['second', 'completed', 1]
  ]);
  assert.deepEqual(files.map((file) => file.sourceId).sort(), ['first', 'second']);
});

test('SyncEngine skips manual scans when there are no enabled tasks and clears stale file state', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({ tasks: [] }));
  await store.upsertFile({
    key: 'old/a.txt',
    sourceId: 'old',
    absolutePath: '/missing/a.txt',
    relativePath: 'a.txt',
    remotePath: '/old/a.txt',
    size: 1,
    status: 'pending'
  });

  const engine = new SyncEngine({ store });
  const result = await engine.scanNow();
  const events = await store.listEvents();

  assert.deepEqual(result, { skipped: true, reason: 'no enabled tasks' });
  assert.equal((await store.stats()).total, 0);
  assert.equal(events.some((event) => event.type === 'scan_completed'), false);
});

test('SyncEngine scheduled runner drains due task queues without a full scan', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'queued.txt');
  await writeFile(filePath, 'queued');
  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [
      { id: 'manual', name: 'Manual', localPath: sourceDir, remotePath: '/Sync/manual', schedule: { type: 'manual' } },
      { id: 'daily', name: 'Daily', localPath: sourceDir, remotePath: '/Sync/daily', schedule: { type: 'daily', time: '09:30' } },
      { id: 'weekly', name: 'Weekly', localPath: sourceDir, remotePath: '/Sync/weekly', schedule: { type: 'weekly', time: '09:30', weekdays: [1] } },
      { id: 'later', name: 'Later', localPath: sourceDir, remotePath: '/Sync/later', schedule: { type: 'daily', time: '10:00' } }
    ]
  }));
  await store.upsertFile({
    key: 'daily/queued.txt',
    sourceId: 'daily',
    absolutePath: filePath,
    relativePath: 'queued.txt',
    remotePath: '/Sync/daily/queued.txt',
    size: 6,
    status: 'pending'
  });

  const calls = [];
  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => {
        throw new Error('scheduled queue processing should not list remote files');
      },
      ensureFolder: async (remotePath) => {
        calls.push(['ensureFolder', remotePath]);
        return { folderid: 42 };
      },
      uploadFile: async (payload) => {
        calls.push(['uploadFile', payload.filename]);
        return { fileids: [42], metadata: [{ fileid: 42, name: payload.filename }] };
      }
    })
  });
  const monday = new Date(2026, 5, 29, 9, 30, 10);

  assert.equal(await engine.runDueTasks(monday), 2);
  assert.deepEqual(calls, [
    ['ensureFolder', '/Sync/daily'],
    ['uploadFile', 'queued.txt']
  ]);
  assert.equal(await engine.runDueTasks(new Date(2026, 5, 29, 9, 30, 40)), 0);
});

test('SyncEngine turns queued local file changes into pending scheduled uploads', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'new.txt');
  await writeFile(filePath, 'new file');
  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [
      { id: 'daily', name: 'Daily', localPath: sourceDir, remotePath: '/Sync/daily', schedule: { type: 'daily', time: '09:30' } }
    ]
  }));
  const calls = [];
  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async (remotePath) => {
        calls.push(['ensureFolder', remotePath]);
        return { folderid: 42 };
      },
      uploadFile: async (payload) => {
        calls.push(['uploadFile', payload.filename]);
        return { fileids: [42], metadata: [{ fileid: 42, name: payload.filename }] };
      }
    })
  });

  engine.queueLocalChange('daily', 'new.txt');

  assert.equal(await engine.runDueTasks(new Date(2026, 5, 29, 9, 30, 10)), 1);
  const files = await store.listFiles();

  assert.deepEqual(calls, [
    ['ensureFolder', '/Sync/daily'],
    ['uploadFile', 'new.txt']
  ]);
  assert.equal(files[0].key, 'daily/new.txt');
  assert.equal(files[0].status, 'synced');
});

test('SyncEngine limits scheduled full-scan fallback to watcher-unavailable tasks', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'queued.txt');
  await writeFile(filePath, 'queued');
  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [
      { id: 'fallback', name: 'Fallback', localPath: sourceDir, remotePath: '/Sync/fallback', schedule: { type: 'daily', time: '09:30' } },
      { id: 'queued', name: 'Queued', localPath: sourceDir, remotePath: '/Sync/queued', schedule: { type: 'daily', time: '09:30' } }
    ]
  }));
  await store.upsertFile({
    key: 'queued/queued.txt',
    sourceId: 'queued',
    absolutePath: filePath,
    relativePath: 'queued.txt',
    remotePath: '/Sync/queued/queued.txt',
    size: 6,
    status: 'pending'
  });

  const uploads = [];
  const scans = [];
  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async (remotePath) => ({ folderid: remotePath.endsWith('queued') ? 9 : 8 }),
      uploadFile: async (payload) => {
        uploads.push(payload.filename);
        return { fileids: [payload.folderid], metadata: [{ fileid: payload.folderid, name: payload.filename }] };
      }
    })
  });
  engine.watchers.set('fallback', {
    taskId: 'fallback',
    path: sourceDir,
    supported: false,
    error: 'recursive watch unsupported'
  });
  engine.scanNow = async (options) => {
    scans.push(options.taskIds);
    return { skipped: false };
  };

  assert.equal(await engine.runDueTasks(new Date(2026, 5, 29, 9, 30, 10)), 2);
  assert.deepEqual(scans, [['fallback']]);
  assert.deepEqual(uploads, ['queued.txt']);
});

test('SyncEngine recovers stale uploading files on the next scan', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'stuck.txt');
  await writeFile(filePath, 'hello');
  let uploads = 0;

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    sources: [{ id: 'docs', path: sourceDir, enabled: true, remoteName: 'Docs' }]
  }));
  await store.upsertFile({
    key: 'docs/stuck.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'stuck.txt',
    remotePath: '/Docs/stuck.txt',
    size: 5,
    mtimeMs: Math.trunc((await stat(filePath)).mtimeMs),
    mtime: Math.trunc((await stat(filePath)).mtimeMs / 1000),
    status: 'uploading'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => new Map(),
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        uploads += 1;
        return { fileids: [101], metadata: [{ fileid: 101, name: 'stuck.txt' }] };
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();

  assert.equal(result.uploaded, 1);
  assert.equal(uploads, 1);
  assert.equal(files[0].status, 'synced');
  assert.equal((await store.stats()).uploading, 0);
});

test('SyncEngine processes stale uploading files when draining the queue directly', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'direct.txt');
  await writeFile(filePath, 'hello');
  const info = await stat(filePath);
  let uploads = 0;

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    sources: [{ id: 'docs', path: sourceDir, enabled: true, remoteName: 'Docs' }]
  }));
  await store.upsertFile({
    key: 'docs/direct.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'direct.txt',
    remotePath: '/Docs/direct.txt',
    size: 5,
    mtimeMs: Math.trunc(info.mtimeMs),
    mtime: Math.trunc(info.mtimeMs / 1000),
    status: 'uploading'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        uploads += 1;
        return { fileids: [104], metadata: [{ fileid: 104, name: 'direct.txt' }] };
      }
    })
  });

  const result = await engine.processPending();
  const files = await store.listFiles();

  assert.equal(result.uploaded, 1);
  assert.equal(uploads, 1);
  assert.equal(files[0].status, 'synced');
  assert.equal((await store.stats()).uploading, 0);
});

test('SyncEngine uploads to the task pCloud folder without prefixing the default root', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'direct-root.txt');
  await writeFile(filePath, 'hello');
  const folders = [];

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS-Backup' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/Sync/Psync', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/direct-root.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'direct-root.txt',
    remotePath: '/Sync/Psync/direct-root.txt',
    size: 5,
    status: 'pending'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async (remotePath) => {
        folders.push(remotePath);
        return { folderid: 42 };
      },
      uploadFile: async () => ({ fileids: [107], metadata: [{ fileid: 107, name: 'direct-root.txt' }] })
    })
  });

  const result = await engine.processPending();
  const files = await store.listFiles();

  assert.equal(result.uploaded, 1);
  assert.deepEqual(folders, ['/Sync/Psync']);
  assert.equal(files[0].pcloudPath, '/Sync/Psync/direct-root.txt');
});

test('SyncEngine stop request aborts active upload and requeues the file', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'stop.txt');
  await writeFile(filePath, 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/Sync/Psync', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/stop.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'stop.txt',
    remotePath: '/Sync/Psync/stop.txt',
    size: 5,
    status: 'pending'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          const error = new Error('Upload stopped');
          error.name = 'AbortError';
          reject(error);
        });
      })
    })
  });

  const processing = engine.processPending();
  await waitFor(() => engine.getStatus().activeUploads.length === 1);
  const stopped = await engine.requestStop();
  const result = await processing;
  const files = await store.listFiles();

  assert.equal(stopped.stopping, true);
  assert.equal(result.stopped, 1);
  assert.equal(files[0].status, 'pending');
  assert.equal(files[0].error, 'Stopped');
  assert.equal(engine.getStatus().activeUploads.length, 0);
});

test('SyncEngine exposes aggregate upload speed while uploads are active', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'speed.txt');
  await writeFile(filePath, 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/NAS/Docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/speed.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'speed.txt',
    remotePath: '/NAS/Docs/speed.txt',
    size: 5,
    status: 'pending'
  });

  let passedProgressHash = '';
  let uploadProgressCalls = 0;
  let finishUpload = () => {};
  const uploadMayFinish = new Promise((resolve) => {
    finishUpload = resolve;
  });
  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async () => ({ folderid: 42 }),
      uploadProgress: async (progressHash) => {
        uploadProgressCalls += 1;
        if (passedProgressHash) {
          assert.equal(progressHash, passedProgressHash);
        }
        return { currentfileuploaded: uploadProgressCalls > 1 ? 5 : 0, currentfilesize: 5 };
      },
      uploadFile: async ({ progressHash }) => {
        passedProgressHash = progressHash;
        await waitFor(() => uploadProgressCalls > 1, 2500);
        await uploadMayFinish;
        return { fileids: [105], metadata: [{ fileid: 105, name: 'speed.txt' }] };
      }
    })
  });

  const processing = engine.processPending();
  try {
    await waitFor(() => engine.getStatus().uploadSpeedBytesPerSecond > 0, 2500);
    assert.ok(engine.getStatus().uploadSpeedBytesPerSecond > 0);
  } finally {
    finishUpload();
  }
  await processing;

  assert.ok(passedProgressHash.startsWith('pcloud-nas-sync-'));
  assert.ok(uploadProgressCalls > 0);
  assert.equal(engine.getStatus().uploadSpeedBytesPerSecond, 0);
});

test('SyncEngine does not calculate upload speed from the first pCloud progress sample', async () => {
  const engine = new SyncEngine({ store: {}, pcloudFactory: () => ({}) });
  engine.activeUploads.set('docs/large.bin', {
    bytes: 0,
    total: 0,
    lastBytes: 0,
    lastAt: Date.now(),
    speed: 0,
    startedAt: Date.now(),
    updatedAt: Date.now()
  });

  engine.recordUploadProgressFromApi('docs/large.bin', {
    currentfileuploaded: 220000 * 1024 * 1024,
    currentfilesize: 250000 * 1024 * 1024
  });

  assert.equal(engine.getStatus().uploadSpeedBytesPerSecond, 0);
});

test('SyncEngine calculates upload speed after a real progress sampling window', async () => {
  const engine = new SyncEngine({ store: {}, pcloudFactory: () => ({}) });
  const startedAt = Date.now() - 1200;
  engine.activeUploads.set('docs/large.bin', {
    bytes: 100 * 1024 * 1024,
    total: 250000 * 1024 * 1024,
    lastBytes: 100 * 1024 * 1024,
    lastAt: startedAt,
    speed: 0,
    hasProgressSample: true,
    startedAt,
    updatedAt: startedAt
  });

  engine.recordUploadProgressFromApi('docs/large.bin', {
    currentfileuploaded: 112 * 1024 * 1024,
    currentfilesize: 250000 * 1024 * 1024
  });

  const speed = engine.getStatus().uploadSpeedBytesPerSecond;
  assert.ok(speed > 8 * 1024 * 1024);
  assert.ok(speed < 14 * 1024 * 1024);
});

test('SyncEngine uses pCloud API server selection before uploading', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'server.txt');
  await writeFile(filePath, 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/NAS/Docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/server.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'server.txt',
    remotePath: '/NAS/Docs/server.txt',
    size: 5,
    status: 'pending'
  });

  const calls = [];
  const uploadClient = {
    ensureFolder: async () => ({ folderid: 42 }),
    uploadProgress: async () => ({ currentfileuploaded: 5, currentfilesize: 5 }),
    uploadFile: async () => ({ fileids: [106], metadata: [{ fileid: 106, name: 'server.txt' }] })
  };
  const nearestClient = {
    currentServer: async () => {
      calls.push('currentServer');
      return { hostname: 'api7.pcloud.com' };
    },
    withHostname: (hostname) => {
      calls.push(['nearest.withHostname', hostname]);
      return uploadClient;
    }
  };
  const baseClient = {
    getApiServer: async () => {
      calls.push('getApiServer');
      return { api: ['api-ams1.pcloud.com', 'api.pcloud.com'] };
    },
    withHostname: (hostname) => {
      calls.push(['base.withHostname', hostname]);
      return nearestClient;
    }
  };

  const engine = new SyncEngine({ store, pcloudFactory: () => baseClient });
  const result = await engine.processPending();

  assert.equal(result.uploaded, 1);
  assert.deepEqual(calls, [
    'getApiServer',
    ['base.withHostname', 'api-ams1.pcloud.com'],
    'currentServer',
    ['nearest.withHostname', 'api7.pcloud.com']
  ]);
});

test('SyncEngine retry action also requeues stale uploading files', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'retry.txt');
  await writeFile(filePath, 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    sources: [{ id: 'docs', path: sourceDir, enabled: true, remoteName: 'Docs' }]
  }));
  await store.upsertFile({
    key: 'docs/retry.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'retry.txt',
    remotePath: '/Docs/retry.txt',
    size: 5,
    status: 'uploading'
  });

  const engine = new SyncEngine({ store });
  const queued = await engine.retryFailed();
  const files = await store.listFiles();

  assert.equal(queued, 1);
  assert.equal(files[0].status, 'pending');
});

test('SyncEngine skips files already present in the remote directory', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'a.txt');
  await writeFile(filePath, 'hello');
  const info = await stat(filePath);
  let uploads = 0;

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    sources: [{ id: 'docs', path: sourceDir, enabled: true, remoteName: 'Docs' }]
  }));

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => new Map([
        ['a.txt', { relativePath: 'a.txt', size: 5, mtimeMs: Math.trunc(info.mtimeMs) }]
      ]),
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        uploads += 1;
        return { fileids: [102] };
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();

  assert.equal(result.queued, 0);
  assert.equal(result.uploaded, 0);
  assert.equal(uploads, 0);
  assert.equal(result.existing, 1);
  assert.equal(files[0].status, 'existing');
  assert.equal(files[0].pcloudPath, '/NAS/Docs/a.txt');
  assert.equal((await store.stats()).existing, 1);
  assert.equal((await store.stats()).synced, 0);
});

test('SyncEngine clears stale file state before rebuilding a scan from current tasks', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'current.txt');
  await writeFile(filePath, 'fresh');
  const info = await stat(filePath);

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/Sync/Psync', enabled: true }]
  }));
  await store.upsertFile({
    key: 'old-task/old.txt',
    sourceId: 'old-task',
    absolutePath: '/missing/old.txt',
    relativePath: 'old.txt',
    remotePath: '/Old/old.txt',
    size: 1,
    status: 'pending'
  });
  await store.upsertFile({
    key: 'old-task/failed.txt',
    sourceId: 'old-task',
    absolutePath: '/missing/failed.txt',
    relativePath: 'failed.txt',
    remotePath: '/Old/failed.txt',
    size: 2,
    status: 'failed',
    error: 'stale'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => new Map([
        ['current.txt', { relativePath: 'current.txt', size: 5, mtimeMs: Math.trunc(info.mtimeMs) }]
      ]),
      ensureFolder: async () => {
        throw new Error('upload should not run for existing files');
      },
      uploadFile: async () => {
        throw new Error('upload should not run for existing files');
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();
  const stats = await store.stats();

  assert.equal(result.discovered, 1);
  assert.equal(result.existing, 1);
  assert.deepEqual(files.map((file) => file.key), ['docs/current.txt']);
  assert.equal(files[0].status, 'existing');
  assert.deepEqual({
    total: stats.total,
    existing: stats.existing,
    synced: stats.synced,
    failed: stats.failed,
    pending: stats.pending,
    uploading: stats.uploading
  }, {
    total: 1,
    existing: 1,
    synced: 0,
    failed: 0,
    pending: 0,
    uploading: 0
  });
});

test('SyncEngine keeps previous scan metadata for same-size change detection while rebuilding file state', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'same-size.txt');
  await writeFile(filePath, 'fresh');
  const info = await stat(filePath);
  const previousMtimeMs = Math.trunc(info.mtimeMs) - 60000;
  let uploads = 0;

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/Sync/Psync', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/same-size.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'same-size.txt',
    remotePath: '/Sync/Psync/same-size.txt',
    size: 5,
    mtimeMs: previousMtimeMs,
    status: 'existing'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async () => new Map([
        ['same-size.txt', { relativePath: 'same-size.txt', size: 5, mtimeMs: previousMtimeMs }]
      ]),
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        uploads += 1;
        return { fileids: [108], metadata: [{ fileid: 108, name: 'same-size.txt' }] };
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();

  assert.equal(result.queued, 1);
  assert.equal(result.uploaded, 1);
  assert.equal(uploads, 1);
  assert.equal(files[0].status, 'synced');
});

test('SyncEngine ignores old dashed state and uploads to the normalized source directory', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const rootDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-root-'));
  const sourceDir = path.join(rootDir, '财务');
  await mkdir(sourceDir);
  const filePath = path.join(sourceDir, 'a.txt');
  await writeFile(filePath, 'hello');
  const oldInfo = await stat(filePath);
  const uploads = [];

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token', remoteRoot: '/NAS' },
    sources: [{ id: '--', path: sourceDir, enabled: true, remoteName: '--' }]
  }));
  await store.upsertFile({
    key: '--/a.txt',
    sourceId: '--',
    absolutePath: filePath,
    relativePath: 'a.txt',
    remotePath: '/--/a.txt',
    size: 5,
    mtimeMs: Math.trunc(oldInfo.mtimeMs),
    mtime: Math.trunc(oldInfo.mtimeMs / 1000),
    status: 'synced',
    pcloudPath: '/NAS/--/a.txt'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteFiles: async (remotePath) => {
        assert.equal(remotePath, '/NAS/财务');
        return new Map();
      },
      ensureFolder: async (remotePath) => {
        assert.equal(remotePath, '/NAS/财务');
        return { folderid: 42 };
      },
      uploadFile: async (payload) => {
        uploads.push(payload.filename);
        return { fileids: [103], metadata: [{ fileid: 103, name: payload.filename }] };
      }
    })
  });

  const result = await engine.scanNow();
  const files = await store.listFiles();

  assert.equal(result.uploaded, 1);
  assert.deepEqual(uploads, ['a.txt']);
  assert.deepEqual(files.map((file) => file.key), ['财务/a.txt']);
  assert.equal(files[0].pcloudPath, '/NAS/财务/a.txt');
});

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(predicate(), true);
}
