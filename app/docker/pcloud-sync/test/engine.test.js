import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config/config.js';
import { JsonStore } from '../src/store/jsonStore.js';
import { SyncEngine } from '../src/sync/engine.js';

test('SyncEngine scans configured sources and queues files when pCloud token is missing', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  await writeFile(path.join(sourceDir, 'a.txt'), 'hello');

  const store = new JsonStore(dataDir);
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

  const store = new JsonStore(dataDir);
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
  assert.ok(events.some((event) => event.type === 'upload_succeeded' && event.subject === 'docs/a.txt'));
  assert.deepEqual(calls.map((call) => call[0]), ['ensureFolder', 'uploadFile']);
  assert.equal(calls[0][1], '/NAS/Docs');
});

test('SyncEngine recovers stale uploading files on the next scan', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'stuck.txt');
  await writeFile(filePath, 'hello');
  let uploads = 0;

  const store = new JsonStore(dataDir);
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

  const store = new JsonStore(dataDir);
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

test('SyncEngine exposes aggregate upload speed while uploads are active', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'speed.txt');
  await writeFile(filePath, 'hello');

  const store = new JsonStore(dataDir);
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
  const engine = new SyncEngine({
    store,
    pcloudFactory: () => ({
      ensureFolder: async () => ({ folderid: 42 }),
      uploadProgress: async (progressHash) => {
        uploadProgressCalls += 1;
        if (passedProgressHash) {
          assert.equal(progressHash, passedProgressHash);
        }
        return { currentfileuploaded: 5, currentfilesize: 5 };
      },
      uploadFile: async ({ progressHash }) => {
        passedProgressHash = progressHash;
        await waitFor(() => uploadProgressCalls > 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { fileids: [105], metadata: [{ fileid: 105, name: 'speed.txt' }] };
      }
    })
  });

  const processing = engine.processPending();
  await waitFor(() => engine.getStatus().uploadSpeedBytesPerSecond > 0);
  assert.ok(engine.getStatus().uploadSpeedBytesPerSecond > 0);
  await processing;

  assert.ok(passedProgressHash.startsWith('pcloud-nas-sync-'));
  assert.ok(uploadProgressCalls > 0);
  assert.equal(engine.getStatus().uploadSpeedBytesPerSecond, 0);
});

test('SyncEngine uses pCloud API server selection before uploading', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-data-'));
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'pcloud-engine-source-'));
  const filePath = path.join(sourceDir, 'server.txt');
  await writeFile(filePath, 'hello');

  const store = new JsonStore(dataDir);
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

  const store = new JsonStore(dataDir);
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

  const store = new JsonStore(dataDir);
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
  assert.equal(files[0].status, 'synced');
  assert.equal(files[0].pcloudPath, '/NAS/Docs/a.txt');
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

  const store = new JsonStore(dataDir);
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
