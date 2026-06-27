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

test('SyncEngine passes renameifexists and verifies successful uploads when checksum mode is all', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'a.txt');
  await writeFile(filePath, 'hello');
  const calls = [];

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    sync: { renameIfExists: true, checksumMode: 'all' },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/a.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'a.txt',
    remotePath: '/Sync/docs/a.txt',
    size: 5,
    status: 'pending'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async (payload) => {
        calls.push(['uploadFile', payload.renameIfExists]);
        return { fileids: [109], metadata: [{ fileid: 109, name: 'a.txt', path: '/Sync/docs/a.txt' }] };
      },
      checksumFile: async (payload) => {
        calls.push(['checksumFile', payload.fileid]);
        return { sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d' };
      }
    })
  });

  const result = await engine.processPending();
  const files = await store.listFiles();

  assert.equal(result.uploaded, 1);
  assert.deepEqual(calls, [
    ['uploadFile', true],
    ['checksumFile', 109]
  ]);
  assert.equal(files[0].checksumSha1, 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
  assert.ok(files[0].checksumVerifiedAt);
});

test('SyncEngine can verify an apparent upload failure by checksum and mark the file synced', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'maybe.txt');
  await writeFile(filePath, 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    sync: { checksumMode: 'failed' },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/maybe.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'maybe.txt',
    remotePath: '/Sync/docs/maybe.txt',
    size: 5,
    status: 'pending'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        throw new Error('socket hang up');
      },
      stat: async (payload) => {
        assert.equal(payload.path, '/Sync/docs/maybe.txt');
        return { metadata: { fileid: 120, path: '/Sync/docs/maybe.txt', size: 5, parentfolderid: 42 } };
      },
      checksumFile: async (payload) => {
        assert.equal(payload.fileid, 120);
        return { sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d' };
      }
    })
  });

  const result = await engine.processPending();
  const files = await store.listFiles();
  const events = await store.listEvents();

  assert.equal(result.uploaded, 1);
  assert.equal(result.failed, 0);
  assert.equal(files[0].status, 'synced');
  assert.equal(files[0].pcloudFileId, 120);
  assert.ok(events.some((event) => event.type === 'upload_verified_after_error'));
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
  assert.equal(second.taskResults[0].scanMode, 'cache');
  assert.equal(remoteScans, 1);
  assert.equal(uploads, 1);
  assert.equal(files[0].status, 'synced');
  assert.equal((await store.stats()).synced, 1);
});

test('SyncEngine can force a full remote comparison even when cached state exists', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  await writeFile(path.join(sourceDir, 'a.txt'), 'hello');
  let remoteScans = 0;

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
        return new Map([
          ['a.txt', { relativePath: 'a.txt', size: 5, mtimeMs: Date.now() }]
        ]);
      },
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => ({ fileids: [109], metadata: [{ fileid: 109, name: 'a.txt' }] })
    })
  });

  await engine.scanNow();
  const result = await engine.scanNow({ forceRemoteScan: true });

  assert.equal(remoteScans, 2);
  assert.equal(result.remoteFiles, 1);
  assert.equal(result.taskResults[0].scanMode, 'remote_full');
});

test('SyncEngine persists scan source, pCloud folder id, file ids, and diff cursor after a remote scan', async () => {
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

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteTree: async () => ({
        folder: { folderid: 42, path: '/Sync/docs' },
        files: new Map([
          ['a.txt', {
            relativePath: 'a.txt',
            path: '/Sync/docs/a.txt',
            size: 5,
            mtimeMs: Math.trunc(info.mtimeMs),
            fileid: 109,
            parentfolderid: 42,
            hash: 'pcloud-hash'
          }]
        ])
      }),
      diff: async () => ({ diffid: 555, entries: [] }),
      ensureFolder: async () => {
        throw new Error('existing files should not upload');
      },
      uploadFile: async () => {
        throw new Error('existing files should not upload');
      }
    })
  });

  const result = await engine.scanNow({ forceRemoteScan: true });
  const files = await store.listFiles();
  const remoteState = await store.getTaskRemoteState('docs');
  const events = await store.listEvents();

  assert.equal(result.taskResults[0].scanMode, 'remote_full');
  assert.equal(files[0].status, 'existing');
  assert.equal(files[0].pcloudFileId, 109);
  assert.equal(files[0].pcloudFolderId, 42);
  assert.equal(files[0].pcloudHash, 'pcloud-hash');
  assert.equal(remoteState.remoteFolderId, 42);
  assert.equal(remoteState.diffid, 555);
  assert.equal(remoteState.lastScanMode, 'remote_full');
  assert.equal(remoteState.lastDiscovered, 1);
  assert.equal(remoteState.lastRemoteFiles, 1);
  assert.equal(typeof remoteState.lastLocalScanMs, 'number');
  assert.equal(typeof remoteState.lastRemoteScanMs, 'number');
  assert.equal(typeof result.taskResults[0].totalScanMs, 'number');
  assert.ok(events.some((event) => event.type === 'scan_completed' && event.message.includes('remote_full')));
  assert.ok(events.some((event) => event.type === 'scan_completed' && event.message.includes('timings Docs:local')));
});

test('SyncEngine uses pCloud diff cursor to validate cached scans without full remote listing', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'a.txt');
  await writeFile(filePath, 'hello');
  const info = await stat(filePath);
  const diffCalls = [];

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
    status: 'synced',
    pcloudFileId: 109
  });
  await store.setTaskRemoteState('docs', {
    remotePath: '/Sync/docs',
    remoteFolderId: 42,
    diffid: 100,
    lastScanMode: 'remote_full'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      diff: async (params) => {
        diffCalls.push(params);
        return { diffid: 101, entries: [{ diffid: 101, event: 'modifyfile', metadata: { path: '/Other/file.txt', fileid: 999 } }] };
      },
      listRemoteFiles: async () => {
        throw new Error('diff-only cached scans should not list the remote tree');
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
  const remoteState = await store.getTaskRemoteState('docs');

  assert.deepEqual(diffCalls, [{ diffid: 100, limit: 1000 }]);
  assert.equal(result.remoteFiles, 0);
  assert.equal(result.taskResults[0].scanMode, 'remote_diff');
  assert.equal(remoteState.diffid, 101);
  assert.equal(remoteState.lastScanMode, 'remote_diff');
});

test('SyncEngine reads pCloud diff pages until the cursor is caught up', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'a.txt');
  await writeFile(filePath, 'hello');
  const info = await stat(filePath);
  const diffCalls = [];

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
    status: 'synced',
    pcloudFileId: 109
  });
  await store.setTaskRemoteState('docs', {
    remotePath: '/Sync/docs',
    remoteFolderId: 42,
    diffid: 100,
    lastScanMode: 'remote_full'
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      diff: async (params) => {
        diffCalls.push(params);
        if (diffCalls.length === 1) {
          return {
            diffid: 101,
            entries: Array.from({ length: 1000 }, (_item, index) => ({
              event: 'modifyfile',
              metadata: { path: `/Other/file-${index}.txt`, fileid: 9000 + index }
            }))
          };
        }
        return { diffid: 102, entries: [] };
      },
      listRemoteFiles: async () => {
        throw new Error('diff paging should avoid a full remote listing for unrelated changes');
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
  const remoteState = await store.getTaskRemoteState('docs');

  assert.deepEqual(diffCalls, [
    { diffid: 100, limit: 1000 },
    { diffid: 101, limit: 1000 }
  ]);
  assert.equal(result.taskResults[0].scanMode, 'remote_diff');
  assert.equal(remoteState.diffid, 102);
});

test('SyncEngine falls back to a full remote comparison when pCloud diff touches the task folder', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  await writeFile(path.join(sourceDir, 'a.txt'), 'hello');
  let remoteScans = 0;

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/a.txt',
    sourceId: 'docs',
    absolutePath: path.join(sourceDir, 'a.txt'),
    relativePath: 'a.txt',
    remotePath: '/Sync/docs/a.txt',
    size: 5,
    status: 'synced',
    pcloudFileId: 109
  });
  await store.setTaskRemoteState('docs', {
    remotePath: '/Sync/docs',
    remoteFolderId: 42,
    diffid: 100
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      diff: async () => ({ diffid: 101, entries: [{ event: 'modifyfile', metadata: { path: '/Sync/docs/a.txt', fileid: 109 } }] }),
      listRemoteTree: async () => {
        remoteScans += 1;
        return { folder: { folderid: 42, path: '/Sync/docs' }, files: new Map() };
      },
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => ({ fileids: [110], metadata: [{ fileid: 110, name: 'a.txt' }] })
    })
  });

  const result = await engine.scanNow();

  assert.equal(remoteScans, 1);
  assert.equal(result.taskResults[0].scanMode, 'remote_diff');
});

test('SyncEngine preserves previous file state when a remote scan fails', async () => {
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
    pcloudFileId: 109
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      listRemoteTree: async () => {
        throw new Error('temporary pCloud listing failure');
      }
    })
  });

  const result = await engine.scanNow({ forceRemoteScan: true });
  const files = await store.listFiles();

  assert.equal(result.failed, 1);
  assert.equal(result.taskResults[0].status, 'failed');
  assert.deepEqual(files.map((file) => [file.key, file.status, file.pcloudFileId]), [
    ['docs/a.txt', 'existing', 109]
  ]);
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

test('SyncEngine falls back to the configured pCloud client when the selected upload server fails', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'fallback.txt');
  await writeFile(filePath, 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/fallback.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'fallback.txt',
    remotePath: '/Sync/docs/fallback.txt',
    size: 5,
    status: 'pending'
  });

  const calls = [];
  const selectedClient = {
    ensureFolder: async () => ({ folderid: 42 }),
    uploadFile: async () => {
      calls.push('selected.uploadFile');
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';
      throw error;
    }
  };
  const baseClient = {
    getApiServer: async () => ({ api: ['api7.pcloud.com'] }),
    withHostname: () => selectedClient,
    ensureFolder: async () => ({ folderid: 42 }),
    uploadFile: async () => {
      calls.push('base.uploadFile');
      return { fileids: [130], metadata: [{ fileid: 130, name: 'fallback.txt' }] };
    }
  };

  const engine = new SyncEngine({ store, pcloudFactory: () => baseClient });
  const result = await engine.processPending();
  const events = await store.listEvents();

  assert.equal(result.uploaded, 1);
  assert.deepEqual(calls, ['selected.uploadFile', 'base.uploadFile']);
  assert.ok(events.some((event) => event.type === 'server_fallback'));
});

test('SyncEngine verifies a transient upload error before retrying on a fallback server', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'verified.txt');
  await writeFile(filePath, 'hello');

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    sync: { checksumMode: 'failed' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/verified.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'verified.txt',
    remotePath: '/Sync/docs/verified.txt',
    size: 5,
    status: 'pending'
  });

  const calls = [];
  const selectedClient = {
    ensureFolder: async () => ({ folderid: 42 }),
    uploadFile: async () => {
      calls.push('selected.uploadFile');
      const error = new Error('socket hang up');
      error.code = 'ECONNRESET';
      throw error;
    },
    stat: async () => {
      calls.push('selected.stat');
      return { metadata: { fileid: 777, path: '/Sync/docs/verified.txt', size: 5, parentfolderid: 42 } };
    },
    checksumFile: async () => {
      calls.push('selected.checksumFile');
      return { sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d' };
    }
  };
  const baseClient = {
    getApiServer: async () => ({ api: ['api7.pcloud.com'] }),
    withHostname: () => selectedClient,
    ensureFolder: async () => ({ folderid: 42 }),
    uploadFile: async () => {
      calls.push('base.uploadFile');
      return { fileids: [778], metadata: [{ fileid: 778, name: 'verified.txt' }] };
    }
  };

  const engine = new SyncEngine({ store, pcloudFactory: () => baseClient });
  const result = await engine.processPending();
  const files = await store.listFiles();

  assert.equal(result.uploaded, 1);
  assert.deepEqual(calls, ['selected.uploadFile', 'selected.stat', 'selected.checksumFile']);
  assert.equal(files[0].status, 'synced');
  assert.equal(files[0].pcloudFileId, 777);
});

test('SyncEngine delays upload when a queued local file changed after scanning', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'changing.txt');
  await writeFile(filePath, 'hello');
  const initialInfo = await stat(filePath);
  await writeFile(filePath, 'hello again');
  const changedInfo = await stat(filePath);

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/changing.txt',
    sourceId: 'docs',
    absolutePath: filePath,
    relativePath: 'changing.txt',
    remotePath: '/Sync/docs/changing.txt',
    size: 5,
    mtimeMs: Math.trunc(initialInfo.mtimeMs),
    mtime: Math.trunc(initialInfo.mtimeMs / 1000),
    status: 'pending'
  });

  const calls = [];
  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        calls.push('uploadFile');
        return { fileids: [130], metadata: [{ fileid: 130, name: 'changing.txt' }] };
      }
    })
  });

  const result = await engine.processPending();
  const files = await store.listFiles();
  const events = await store.listEvents();

  assert.equal(result.uploaded, 0);
  assert.deepEqual(calls, []);
  assert.equal(files[0].status, 'pending');
  assert.equal(files[0].size, changedInfo.size);
  assert.equal(files[0].mtimeMs, Math.trunc(changedInfo.mtimeMs));
  assert.ok(events.some((event) => event.type === 'upload_delayed' && event.subject === 'docs/changing.txt'));
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

test('SyncEngine adopts same-size remote files with different mtimes and records diagnostics', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'a.txt');
  await writeFile(filePath, 'hello');
  const info = await stat(filePath);
  const remoteMtimeMs = Math.trunc(info.mtimeMs) - 60000;
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
      listRemoteFiles: async () => new Map([
        ['a.txt', { relativePath: 'a.txt', size: 5, mtimeMs: remoteMtimeMs, fileid: 220 }]
      ]),
      ensureFolder: async () => ({ folderid: 42 }),
      uploadFile: async () => {
        uploads += 1;
        return { fileids: [220] };
      }
    })
  });

  const result = await engine.scanNow({ forceRemoteScan: true });
  const files = await store.listFiles();
  const remoteState = await store.getTaskRemoteState('docs');

  assert.equal(result.queued, 0);
  assert.equal(result.existing, 1);
  assert.equal(uploads, 0);
  assert.equal(result.taskResults[0].mtimeMismatches, 1);
  assert.equal(remoteState.lastMtimeMismatches, 1);
  assert.equal(files[0].status, 'existing');
  assert.equal(files[0].pcloudMtimeMs, remoteMtimeMs);
  assert.equal(files[0].pcloudFileId, 220);
});

test('SyncEngine samples checksum verification for mtime-mismatched existing files', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const aPath = path.join(sourceDir, 'a.txt');
  const bPath = path.join(sourceDir, 'b.txt');
  await writeFile(aPath, 'hello');
  await writeFile(bPath, 'world');
  const aInfo = await stat(aPath);
  const bInfo = await stat(bPath);
  const calls = [];

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));
  await store.upsertFile({
    key: 'docs/a.txt',
    sourceId: 'docs',
    absolutePath: aPath,
    relativePath: 'a.txt',
    remotePath: '/Sync/docs/a.txt',
    pcloudFileId: 101,
    size: 5,
    mtimeMs: Math.trunc(aInfo.mtimeMs),
    status: 'existing',
    mtimeMismatch: true
  });
  await store.upsertFile({
    key: 'docs/b.txt',
    sourceId: 'docs',
    absolutePath: bPath,
    relativePath: 'b.txt',
    remotePath: '/Sync/docs/b.txt',
    pcloudFileId: 102,
    size: 5,
    mtimeMs: Math.trunc(bInfo.mtimeMs),
    status: 'existing',
    mtimeMismatch: true
  });

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      checksumFile: async ({ fileid }) => {
        calls.push(fileid);
        return { sha1: fileid === 101 ? 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d' : 'bad' };
      }
    })
  });

  const result = await engine.verifyMtimeMismatchSample({ taskId: 'docs', limit: 2 });
  const files = await store.listFiles({ sourceId: 'docs' });

  assert.deepEqual(calls, [101, 102]);
  assert.equal(result.totalCandidates, 2);
  assert.equal(result.checked, 2);
  assert.equal(result.matched, 1);
  assert.equal(result.mismatched, 1);
  assert.equal(result.failed, 0);
  assert.equal(files.find((file) => file.key === 'docs/a.txt').checksumVerifiedAt, result.results[0].verifiedAt);
});

test('SyncEngine verifies all mtime-mismatched files with bounded concurrency', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const names = ['a.txt', 'b.txt', 'c.txt', 'd.txt'];
  const calls = [];
  let active = 0;
  let maxActive = 0;

  const store = new SqliteStore(dataDir);
  await store.init();
  await store.saveConfig(normalizeConfig({
    pcloud: { accessToken: 'token' },
    sync: { mtimeVerifyConcurrency: 2 },
    tasks: [{ id: 'docs', name: 'Docs', localPath: sourceDir, remotePath: '/Sync/docs', enabled: true }]
  }));

  for (const [index, name] of names.entries()) {
    const filePath = path.join(sourceDir, name);
    await writeFile(filePath, 'hello');
    const info = await stat(filePath);
    await store.upsertFile({
      key: `docs/${name}`,
      sourceId: 'docs',
      absolutePath: filePath,
      relativePath: name,
      remotePath: `/Sync/docs/${name}`,
      pcloudFileId: 200 + index,
      size: 5,
      mtimeMs: Math.trunc(info.mtimeMs),
      status: 'existing',
      mtimeMismatch: true
    });
  }

  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      checksumFile: async ({ fileid }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        calls.push(fileid);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { sha1: 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d' };
      }
    })
  });

  const result = await engine.verifyMtimeMismatches({ taskId: 'docs' });
  const files = await store.listFiles({ sourceId: 'docs' });

  assert.deepEqual(calls.sort((a, b) => a - b), [200, 201, 202, 203]);
  assert.equal(maxActive, 2);
  assert.equal(result.totalCandidates, 4);
  assert.equal(result.checked, 4);
  assert.equal(result.matched, 4);
  assert.equal(result.mismatched, 0);
  assert.equal(result.failed, 0);
  assert.equal(files.every((file) => file.mtimeMismatchVerified === true), true);
  assert.equal(files.every((file) => file.mtimeMismatchStatus === 'matched'), true);
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
