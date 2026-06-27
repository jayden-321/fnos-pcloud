import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig, redactConfig } from '../config/config.js';
import { defaultLocalRoots, listLocalFolders } from '../folders/localFolders.js';
import { PCloudClient } from '../pcloud/client.js';
import { APP_VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

export function createApp({ store, engine, pcloudFactory = null, localRoots = null }) {
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
          return await handleApi({ request, url, store, engine, pcloudFactory, localRoots });
        }
        return await serveStatic(url.pathname);
      } catch (error) {
        return json({ error: error.message }, error.statusCode || 500);
      }
    }
  };
}

export function listen(app, port, host = '0.0.0.0') {
  const server = createServer(async (req, res) => {
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
      duplex: ['GET', 'HEAD'].includes(req.method) ? undefined : 'half'
    });
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) {
        res.write(chunk);
      }
    }
    res.end();
  });
  server.listen(port, host);
  return server;
}

async function handleApi({ request, url, store, engine, pcloudFactory, localRoots }) {
  if (request.method === 'GET' && url.pathname === '/api/config') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    return json(redactConfig(config));
  }

  if (request.method === 'POST' && url.pathname === '/api/config') {
    const previous = normalizeConfig(await store.loadConfig() ?? {});
    const body = await request.json();
    const config = normalizeConfig(mergeConfig(previous, body));
    await store.saveConfig(config);
    await store.pruneEvents();
    await engine.refreshWatchers?.(config);
    return json(redactConfig(config));
  }

  if (request.method === 'GET' && url.pathname === '/api/status') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const engineStatus = engine.getStatus?.() ?? {};
    const remoteStates = new Map((await store.listTaskRemoteStates?.() ?? []).map((state) => [state.taskId, state]));
    return json({
      version: APP_VERSION,
      tasks: config.tasks,
      taskStats: await Promise.all(config.tasks.map(async (task) => ({
        id: task.id,
        name: task.name,
        stats: await store.stats({ sourceId: task.id }),
        mtimeVerification: await mtimeVerificationStats(store, task.id),
        remoteState: remoteStates.get(task.id) ?? null
      }))),
      stats: await store.stats(),
      failed: await store.listFiles({ status: 'failed' }),
      pending: await store.listFiles({ status: 'pending' }),
      uploading: await store.listFiles({ status: 'uploading' }),
      events: await store.listEvents(200),
      engine: engineStatus
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/local-folders') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const roots = localRoots ?? defaultLocalRoots(config.tasks.map((task) => task.localPath));
    return json(await listLocalFolders(url.searchParams.get('path') || '', roots));
  }

  if (request.method === 'GET' && url.pathname === '/api/mtime-mismatches') {
    return json(await listMtimeMismatchDetails(store, {
      taskId: url.searchParams.get('taskId') || '',
      status: url.searchParams.get('status') || ''
    }));
  }

  if (request.method === 'POST' && url.pathname === '/api/mtime-mismatches/resolve') {
    const body = await readJsonBody(request);
    if (!engine.resolveMtimeMismatch) {
      return json({ error: 'Mtime mismatch resolution is unavailable' }, 501);
    }
    return json(await engine.resolveMtimeMismatch({
      key: String(body.key || '').trim(),
      action: String(body.action || '').trim()
    }));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/folders') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.listRemoteFolders(url.searchParams.get('path') || '/'));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/current-server') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.currentServer());
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/api-server') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.getApiServer());
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/upload-progress') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.uploadProgress(url.searchParams.get('progresshash') || ''));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/checksum') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.checksumFile({
      fileid: url.searchParams.get('fileid'),
      path: url.searchParams.get('path') || ''
    }));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/stat') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.stat({
      fileid: url.searchParams.get('fileid'),
      path: url.searchParams.get('path') || ''
    }));
  }

  if (request.method === 'GET' && url.pathname === '/api/pcloud/diff') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.diff(Object.fromEntries(url.searchParams.entries())));
  }

  if (request.method === 'POST' && url.pathname === '/api/pcloud/folders') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const body = await request.json();
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.ensureFolder(body.path));
  }

  if (request.method === 'POST' && url.pathname === '/api/scan') {
    const body = await readJsonBody(request);
    const taskIds = Array.isArray(body.taskIds)
      ? body.taskIds.map((item) => String(item || '').trim()).filter(Boolean)
      : body.taskId ? [String(body.taskId).trim()].filter(Boolean) : [];
    return json(await engine.scanNow({
      taskIds,
      trigger: 'manual',
      forceRemoteScan: body.forceRemoteScan === true
    }));
  }

  if (request.method === 'POST' && url.pathname === '/api/verify-mtime-mismatch-sample') {
    const body = await readJsonBody(request);
    if (engine.startMtimeMismatchVerification) {
      return json(await engine.startMtimeMismatchVerification({
        taskId: String(body.taskId || '').trim()
      }));
    }
    if (!engine.verifyMtimeMismatchSample) {
      return json({ error: 'Mtime mismatch sample verification is unavailable' }, 501);
    }
    return json(await engine.verifyMtimeMismatchSample({
      taskId: String(body.taskId || '').trim(),
      limit: Number(body.limit || 20)
    }));
  }

  if (request.method === 'POST' && url.pathname === '/api/verify-mtime-mismatches') {
    const body = await readJsonBody(request);
    if (!engine.startMtimeMismatchVerification) {
      return json({ error: 'Mtime mismatch verification is unavailable' }, 501);
    }
    return json(await engine.startMtimeMismatchVerification({
      taskId: String(body.taskId || '').trim()
    }));
  }

  if (request.method === 'POST' && url.pathname === '/api/verify-mtime-mismatches/stop') {
    const body = await readJsonBody(request);
    if (!engine.stopMtimeMismatchVerification) {
      return json({ error: 'Mtime mismatch verification pause is unavailable' }, 501);
    }
    return json(await engine.stopMtimeMismatchVerification({
      taskId: String(body.taskId || '').trim()
    }));
  }

  if (request.method === 'POST' && url.pathname === '/api/speed-test') {
    const body = await readJsonBody(request);
    if (!engine.startSpeedTest) {
      return json({ error: 'pCloud speed test is unavailable' }, 501);
    }
    return json(await engine.startSpeedTest({
      sizeMb: Number(body.sizeMb || 50)
    }));
  }

  if (request.method === 'POST' && url.pathname === '/api/stop') {
    if (!engine.requestStop) {
      return json({ stopping: false, activeUploads: 0 });
    }
    return json(await engine.requestStop());
  }

  if (request.method === 'POST' && url.pathname === '/api/retry-failed') {
    const queued = await engine.retryFailed();
    const drained = queued > 0 && engine.processPending ? await engine.processPending() : { uploaded: 0, failed: 0 };
    return json({ queued, uploaded: drained.uploaded ?? 0, failed: drained.failed ?? 0 });
  }

  if (request.method === 'DELETE' && url.pathname === '/api/events') {
    return json({ deleted: await store.clearEvents() });
  }

  if (request.method === 'POST' && url.pathname === '/api/oauth/exchange') {
    const body = await request.json();
    const config = normalizeConfig(mergeConfig(await store.loadConfig() ?? {}, body));
    const client = new PCloudClient({
      hostname: config.pcloud.hostname,
      accessToken: config.pcloud.accessToken
    });
    const token = await client.exchangeCode({
      clientId: config.pcloud.clientId,
      clientSecret: config.pcloud.clientSecret,
      code: body.code
    });
    config.pcloud.accessToken = token.accessToken;
    if (token.hostname) {
      config.pcloud.hostname = token.hostname;
    }
    await store.saveConfig(config);
    return json({ tokenType: token.tokenType, uid: token.uid, config: redactConfig(config) });
  }

  if (request.method === 'POST' && url.pathname === '/api/pcloud/test') {
    const config = normalizeConfig(await store.loadConfig() ?? {});
    const client = pcloudFactory ? pcloudFactory(config) : new PCloudClient(config.pcloud);
    return json(await client.userInfo());
  }

  return json({ error: 'Not found' }, 404);
}

async function serveStatic(urlPath) {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(await readFile(filePath), {
      headers: { 'content-type': contentType(filePath) }
    });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return new Response('Not found', { status: 404 });
    }
    throw error;
  }
}

function mergeConfig(previous, patch) {
  const pcloudPatch = { ...(patch.pcloud ?? {}) };
  for (const key of ['clientSecret', 'accessToken']) {
    if (['***', '******', ''].includes(pcloudPatch[key])) {
      delete pcloudPatch[key];
    }
  }
  const hasTasksPatch = Object.hasOwn(patch, 'tasks');
  return {
    ...previous,
    ...patch,
    pcloud: { ...(previous.pcloud ?? {}), ...pcloudPatch },
    sync: { ...(previous.sync ?? {}), ...(patch.sync ?? {}) },
    tasks: hasTasksPatch ? patch.tasks : previous.tasks ?? [],
    sources: Object.hasOwn(patch, 'sources') ? patch.sources : hasTasksPatch ? [] : previous.sources ?? []
  };
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(body, status = 200) {
  return Response.json(body, { status });
}

async function mtimeVerificationStats(store, taskId) {
  const files = await store.listFiles({ sourceId: taskId, status: 'existing' });
  const stats = {
    total: 0,
    verified: 0,
    matched: 0,
    mismatched: 0,
    failed: 0,
    pending: 0
  };
  for (const file of files) {
    if (file.mtimeMismatch !== true) {
      continue;
    }
    stats.total += 1;
    if (file.mtimeMismatchStatus === 'matched') {
      stats.verified += 1;
      stats.matched += 1;
    } else if (file.mtimeMismatchStatus === 'mismatched') {
      stats.verified += 1;
      stats.mismatched += 1;
    } else if (file.mtimeMismatchStatus === 'failed') {
      stats.failed += 1;
    } else {
      stats.pending += 1;
    }
  }
  return stats;
}

async function listMtimeMismatchDetails(store, { taskId = '', status = '' } = {}) {
  const normalizedTaskId = String(taskId || '').trim();
  const normalizedStatus = String(status || '').trim();
  const allowedStatuses = new Set(['matched', 'mismatched', 'failed', '']);
  const targetStatus = allowedStatuses.has(normalizedStatus) ? normalizedStatus : '';
  const filter = { status: 'existing' };
  if (normalizedTaskId) {
    filter.sourceId = normalizedTaskId;
  }
  const candidates = (await store.listFiles(filter))
    .filter((file) => file.mtimeMismatch === true)
    .filter((file) => !targetStatus || file.mtimeMismatchStatus === targetStatus)
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return {
    taskId: normalizedTaskId,
    status: targetStatus,
    total: candidates.length,
    files: candidates.slice(0, 500).map((file) => ({
      key: file.key,
      sourceId: file.sourceId || '',
      relativePath: file.relativePath || file.key,
      remotePath: file.pcloudPath || file.remotePath || '',
      pcloudFileId: file.pcloudFileId ?? null,
      size: Number(file.size || 0),
      status: file.mtimeMismatchStatus || '',
      error: file.mtimeMismatchError || file.checksumSampleError || '',
      verifiedAt: file.mtimeMismatchVerifiedAt || file.checksumVerifiedAt || ''
    }))
  };
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
