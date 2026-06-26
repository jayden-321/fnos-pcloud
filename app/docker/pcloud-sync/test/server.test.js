import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/web/server.js';
import { JsonStore } from '../src/store/jsonStore.js';

test('HTTP API returns redacted config and aggregate status', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-'));
  const store = new JsonStore(dir);
  await store.init();
  await store.saveConfig({
    port: 8080,
    pcloud: { accessToken: 'secret', hostname: 'api.pcloud.com', remoteRoot: '/NAS-Backup' },
    sync: { intervalSeconds: 300, concurrency: 2, ignorePatterns: [] },
    sources: []
  });
  await store.upsertFile({ key: 'a.txt', status: 'failed', size: 1, error: 'quota' });
  await store.upsertFile({ key: 'b.txt', status: 'uploading', size: 2, error: '' });
  await store.upsertFile({ key: 'c.txt', status: 'existing', size: 3, error: '' });
  for (let index = 0; index < 75; index += 1) {
    await store.addEvent('upload_failed', `docs/${index}.txt`, 'socket hang up');
  }

  const app = createApp({ store, engine: { scanNow: async () => ({ queued: 0 }), retryFailed: async () => 1 } });
  const configResponse = await app.fetch(new Request('http://local/api/config'));
  const statusResponse = await app.fetch(new Request('http://local/api/status'));
  const pageResponse = await app.fetch(new Request('http://local/'));
  const status = await statusResponse.json();
  const pageText = await pageResponse.text();

  assert.equal(configResponse.status, 200);
  assert.equal((await configResponse.json()).pcloud.accessToken, '***');
  assert.equal(status.version, '0.2.11');
  assert.equal(status.stats.failed, 1);
  assert.equal(status.stats.existing, 1);
  assert.deepEqual(status.tasks, []);
  assert.deepEqual(status.uploading.map((file) => file.key), ['b.txt']);
  assert.equal(status.events.length, 75);
  assert.match(pageText, /id="eventSearch"/);
  assert.match(pageText, /data-tab="tasks"/);
  assert.match(pageText, /id="createTask"/);
});

test('HTTP API returns per-task stats and engine task queue state', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-task-stats-'));
  const store = new JsonStore(dir);
  await store.init();
  await store.saveConfig({
    port: 8080,
    pcloud: { accessToken: 'secret', hostname: 'api.pcloud.com', remoteRoot: '/' },
    sync: { intervalSeconds: 300, concurrency: 2, ignorePatterns: [] },
    tasks: [
      { id: 'docs', name: 'Docs', localPath: '/vol1/docs', remotePath: '/Sync/docs', enabled: true },
      { id: 'pics', name: 'Pics', localPath: '/vol1/pics', remotePath: '/Sync/pics', enabled: true }
    ]
  });
  await store.upsertFile({ key: 'docs/a.txt', sourceId: 'docs', status: 'synced', size: 10 });
  await store.upsertFile({ key: 'docs/b.txt', sourceId: 'docs', status: 'existing', size: 20 });
  await store.upsertFile({ key: 'pics/a.jpg', sourceId: 'pics', status: 'pending', size: 30 });

  const app = createApp({
    store,
    engine: {
      getStatus: () => ({
        currentTaskId: 'pics',
        currentTaskName: 'Pics',
        taskQueue: [
          { id: 'docs', name: 'Docs', status: 'completed' },
          { id: 'pics', name: 'Pics', status: 'running' }
        ]
      })
    }
  });
  const response = await app.fetch(new Request('http://local/api/status'));
  const status = await response.json();

  assert.equal(response.status, 200);
  assert.equal(status.engine.currentTaskId, 'pics');
  assert.deepEqual(status.taskStats.map((task) => [task.id, task.stats.total, task.stats.synced, task.stats.existing, task.stats.pending]), [
    ['docs', 2, 1, 1, 0],
    ['pics', 1, 0, 0, 1]
  ]);
});

test('HTTP API passes a requested task id to manual scans', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-scan-task-'));
  const store = new JsonStore(dir);
  await store.init();
  let scanOptions = null;

  const app = createApp({
    store,
    engine: {
      scanNow: async (options) => {
        scanOptions = options;
        return { queued: 0 };
      }
    }
  });
  const response = await app.fetch(new Request('http://local/api/scan', {
    method: 'POST',
    body: JSON.stringify({ taskId: 'docs' })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(scanOptions, { taskIds: ['docs'], trigger: 'manual' });
});

test('HTTP API drains the pending queue after retrying failed or stuck files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-'));
  const store = new JsonStore(dir);
  await store.init();
  let retried = false;
  let drained = false;

  const app = createApp({
    store,
    engine: {
      retryFailed: async () => {
        retried = true;
        return 1;
      },
      processPending: async () => {
        drained = true;
        return { uploaded: 1, failed: 0 };
      }
    }
  });
  const response = await app.fetch(new Request('http://local/api/retry-failed', { method: 'POST' }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(retried, true);
  assert.equal(drained, true);
  assert.deepEqual(body, { queued: 1, uploaded: 1, failed: 0 });
});

test('HTTP API requests the engine to stop the active sync', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-'));
  const store = new JsonStore(dir);
  await store.init();
  let stopRequested = false;

  const app = createApp({
    store,
    engine: {
      requestStop: async () => {
        stopRequested = true;
        return { stopping: true, activeUploads: 1 };
      }
    }
  });
  const response = await app.fetch(new Request('http://local/api/stop', { method: 'POST' }));

  assert.equal(response.status, 200);
  assert.equal(stopRequested, true);
  assert.deepEqual(await response.json(), { stopping: true, activeUploads: 1 });
});

test('HTTP API keeps saved token masks and allows deleting all tasks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-'));
  const store = new JsonStore(dir);
  await store.init();
  await store.saveConfig({
    port: 8080,
    pcloud: { accessToken: 'old-token', hostname: 'api.pcloud.com', remoteRoot: '/NAS' },
    sync: { intervalSeconds: 300, concurrency: 2, ignorePatterns: [] },
    tasks: [{ id: 'docs', name: 'docs', localPath: '/vol1/docs', remotePath: '/NAS/docs', enabled: true }],
    sources: [{ id: 'docs', path: '/vol1/docs', enabled: true, remoteName: 'docs' }]
  });

  const app = createApp({ store, engine: {} });
  const response = await app.fetch(new Request('http://local/api/config', {
    method: 'POST',
    body: JSON.stringify({
      pcloud: { hostname: 'api.pcloud.com', accessToken: '******' },
      tasks: []
    })
  }));
  const body = await response.json();
  const saved = await store.loadConfig();

  assert.equal(response.status, 200);
  assert.equal(body.pcloud.accessToken, '***');
  assert.deepEqual(body.tasks, []);
  assert.deepEqual(saved.tasks, []);
  assert.deepEqual(saved.sources, []);
  assert.equal(saved.pcloud.accessToken, 'old-token');
});

test('HTTP API prunes and clears sync logs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-events-'));
  const store = new JsonStore(dir);
  await store.init();
  await store.saveConfig({
    port: 8080,
    pcloud: { accessToken: 'secret', hostname: 'api.pcloud.com', remoteRoot: '/NAS' },
    sync: { intervalSeconds: 300, concurrency: 2, logRetentionDays: 0, logRetentionCount: 5, ignorePatterns: [] },
    tasks: []
  });
  for (let index = 0; index < 5; index += 1) {
    await store.addEvent('upload_succeeded', `docs/${index}.txt`, '');
  }

  const app = createApp({ store, engine: {} });
  const saveResponse = await app.fetch(new Request('http://local/api/config', {
    method: 'POST',
    body: JSON.stringify({ sync: { logRetentionDays: 0, logRetentionCount: 2 } })
  }));

  assert.equal(saveResponse.status, 200);
  assert.equal((await store.listEvents()).length, 2);

  const clearResponse = await app.fetch(new Request('http://local/api/events', { method: 'DELETE' }));

  assert.equal(clearResponse.status, 200);
  assert.deepEqual(await clearResponse.json(), { deleted: 2 });
  assert.equal((await store.listEvents()).length, 0);
});

test('HTTP API lists local folders inside allowed roots only', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-'));
  const root = await mkdtemp(path.join(tmpdir(), 'pcloud-local-root-'));
  await mkdir(path.join(root, '财务'));
  await mkdir(path.join(root, 'photos'));
  await writeFile(path.join(root, 'file.txt'), 'not a directory');
  const store = new JsonStore(dir);
  await store.init();

  const app = createApp({
    store,
    engine: {},
    localRoots: [root]
  });
  const response = await app.fetch(new Request(`http://local/api/local-folders?path=${encodeURIComponent(root)}`));
  const body = await response.json();
  const blocked = await app.fetch(new Request('http://local/api/local-folders?path=/etc'));

  assert.equal(response.status, 200);
  assert.equal(body.path, root);
  assert.deepEqual(body.entries.map((entry) => entry.name), ['photos', '财务']);
  assert.equal(blocked.status, 403);
});

test('HTTP API lists and creates remote pCloud folders', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-'));
  const store = new JsonStore(dir);
  await store.init();
  await store.saveConfig({
    port: 8080,
    pcloud: { accessToken: 'secret', hostname: 'api.pcloud.com', remoteRoot: '/NAS' },
    sync: { intervalSeconds: 300, concurrency: 2, ignorePatterns: [] },
    tasks: []
  });
  const calls = [];

  const app = createApp({
    store,
    engine: {},
    pcloudFactory: () => ({
      listRemoteFolders: async (remotePath) => {
        calls.push(['list', remotePath]);
        return {
          path: remotePath,
          parent: '/',
          entries: [{ name: '财务', path: remotePath === '/' ? '/财务' : `${remotePath}/财务`, folderid: 7 }]
        };
      },
      ensureFolder: async (remotePath) => {
        calls.push(['create', remotePath]);
        return { folderid: 8, path: remotePath };
      }
    })
  });
  const listResponse = await app.fetch(new Request('http://local/api/pcloud/folders?path=/NAS'));
  const rootListResponse = await app.fetch(new Request('http://local/api/pcloud/folders'));
  const createResponse = await app.fetch(new Request('http://local/api/pcloud/folders', {
    method: 'POST',
    body: JSON.stringify({ path: '/NAS/New' })
  }));

  assert.deepEqual(await listResponse.json(), { path: '/NAS', parent: '/', entries: [{ name: '财务', path: '/NAS/财务', folderid: 7 }] });
  assert.deepEqual(await rootListResponse.json(), { path: '/', parent: '/', entries: [{ name: '财务', path: '/财务', folderid: 7 }] });
  assert.deepEqual(await createResponse.json(), { folderid: 8, path: '/NAS/New' });
  assert.deepEqual(calls, [['list', '/NAS'], ['list', '/'], ['create', '/NAS/New']]);
});

test('HTTP API exposes pCloud progress, checksum, diff, and server APIs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-server-'));
  const store = new JsonStore(dir);
  await store.init();
  await store.saveConfig({
    port: 8080,
    pcloud: { accessToken: 'secret', hostname: 'api.pcloud.com', remoteRoot: '/NAS' },
    sync: { intervalSeconds: 300, concurrency: 2, ignorePatterns: [] },
    tasks: []
  });
  const calls = [];

  const app = createApp({
    store,
    engine: {},
    pcloudFactory: () => ({
      currentServer: async () => {
        calls.push('currentServer');
        return { hostname: 'api7.pcloud.com' };
      },
      getApiServer: async () => {
        calls.push('getApiServer');
        return { api: ['api7.pcloud.com'] };
      },
      uploadProgress: async (progresshash) => {
        calls.push(['uploadProgress', progresshash]);
        return { uploaded: 10, total: 20 };
      },
      checksumFile: async (payload) => {
        calls.push(['checksumFile', payload.path]);
        return { sha1: 'abc' };
      },
      diff: async (payload) => {
        calls.push(['diff', payload.diffid]);
        return { diffid: 43, entries: [] };
      }
    })
  });

  assert.deepEqual(await (await app.fetch(new Request('http://local/api/pcloud/current-server'))).json(), { hostname: 'api7.pcloud.com' });
  assert.deepEqual(await (await app.fetch(new Request('http://local/api/pcloud/api-server'))).json(), { api: ['api7.pcloud.com'] });
  assert.deepEqual(await (await app.fetch(new Request('http://local/api/pcloud/upload-progress?progresshash=h1'))).json(), { uploaded: 10, total: 20 });
  assert.deepEqual(await (await app.fetch(new Request('http://local/api/pcloud/checksum?path=/NAS/a.txt'))).json(), { sha1: 'abc' });
  assert.deepEqual(await (await app.fetch(new Request('http://local/api/pcloud/diff?diffid=42'))).json(), { diffid: 43, entries: [] });
  assert.deepEqual(calls, [
    'currentServer',
    'getApiServer',
    ['uploadProgress', 'h1'],
    ['checksumFile', '/NAS/a.txt'],
    ['diff', '42']
  ]);
});
