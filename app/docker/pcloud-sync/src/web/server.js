import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeConfig, redactConfig } from '../config/config.js';
import { defaultLocalRoots, listLocalFolders } from '../folders/localFolders.js';
import { PCloudClient } from '../pcloud/client.js';
import { fileStreamWithCleanup as resticFileStreamWithCleanup } from '../restic/service.js';
import { APP_VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../../public');

export function createApp({ store, engine, restic = null, pcloudFactory = null, localRoots = null }) {
  return {
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
          return await handleApi({ request, url, store, engine, restic, pcloudFactory, localRoots });
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

async function handleApi({ request, url, store, engine, restic, pcloudFactory, localRoots }) {
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
      engine: engineStatus,
      restic: restic?.getStatus?.() ?? { active: false },
      resticTasks: restic?.taskStatuses ? await restic.taskStatuses() : []
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/restic/status') {
    return json({
      job: restic?.getStatus?.() ?? { active: false },
      tasks: restic?.taskStatuses ? await restic.taskStatuses() : []
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/restic/password') {
    requireRestic(restic);
    const body = await readJsonBody(request);
    return json(await restic.setPassword(body.taskId, body.password));
  }

  if (request.method === 'GET' && url.pathname === '/api/restic/recovery') {
    requireRestic(restic);
    const recovery = await restic.exportRecovery(url.searchParams.get('taskId') || '');
    return new Response(recovery.content, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': contentDisposition(recovery.filename),
        'cache-control': 'no-store'
      }
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/restic/backup') {
    requireRestic(restic);
    const body = await readJsonBody(request);
    return json(await restic.startBackup(body.taskId), 202);
  }

  if (request.method === 'POST' && url.pathname === '/api/restic/check') {
    requireRestic(restic);
    const body = await readJsonBody(request);
    return json(await restic.startCheck(body.taskId), 202);
  }

  if (request.method === 'POST' && url.pathname === '/api/restic/prune') {
    requireRestic(restic);
    const body = await readJsonBody(request);
    return json(await restic.startPrune(body.taskId), 202);
  }

  if (request.method === 'POST' && url.pathname === '/api/restic/index/rebuild') {
    requireRestic(restic);
    const body = await readJsonBody(request);
    return json(await restic.startIndexRebuild(body.taskId, body.snapshot || ''), 202);
  }

  if (request.method === 'POST' && url.pathname === '/api/restic/stop') {
    requireRestic(restic);
    return json(restic.stopJob());
  }

  if (request.method === 'GET' && url.pathname === '/api/restic/snapshots') {
    requireRestic(restic);
    return json({ snapshots: await restic.snapshots(url.searchParams.get('taskId') || '') });
  }

  if (request.method === 'GET' && url.pathname === '/api/restic/browse') {
    requireRestic(restic);
    return json(await restic.browse(
      url.searchParams.get('taskId') || '',
      url.searchParams.get('snapshot') || '',
      url.searchParams.get('path') || ''
    ));
  }

  if (request.method === 'GET' && url.pathname === '/api/restic/download') {
    requireRestic(restic);
    const download = await restic.prepareDownload(
      url.searchParams.get('taskId') || '',
      url.searchParams.get('snapshot') || '',
      url.searchParams.get('path') || '',
      { zip: url.searchParams.get('zip') === '1' }
    );
    const info = await stat(download.filePath);
    return new Response(resticFileStreamWithCleanup(download.filePath, download.tempDir), {
      headers: {
        'content-type': download.contentType,
        'content-length': String(info.size),
        'content-disposition': contentDisposition(download.filename),
        'cache-control': 'no-store'
      }
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/restic/restore') {
    requireRestic(restic);
    const body = await readJsonBody(request);
    return json(await restic.restoreToNas(body.taskId, body.snapshot, body.path || ''));
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

  if (request.method === 'DELETE' && url.pathname === '/api/queue') {
    const status = engine.getStatus?.() ?? {};
    if (status.active || status.activeUploads?.length) {
      return json({ error: '同步正在运行，请先停止同步再清理队列' }, 409);
    }
    return json({ deleted: await store.clearFiles() });
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

function requireRestic(restic) {
  if (!restic) {
    const error = new Error('Restic service is unavailable');
    error.statusCode = 501;
    throw error;
  }
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

async function downloadDecryptedFile({ store, client, remotePath }) {
  const normalizedRemotePath = String(remotePath || '').trim();
  if (!normalizedRemotePath.endsWith('.pcenc')) {
    return json({ error: 'Encrypted pCloud file path must end with .pcenc' }, 400);
  }
  if (!client?.downloadFile) {
    return json({ error: 'pCloud download is unavailable' }, 501);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'pcloud-decrypt-download-'));
  const encryptedPath = path.join(tempDir, 'encrypted.pcenc');
  const decryptedPath = path.join(tempDir, 'decrypted');
  try {
    await client.downloadFile({
      path: normalizedRemotePath,
      filePath: encryptedPath
    });
    await decryptFile({
      sourcePath: encryptedPath,
      targetPath: decryptedPath,
      masterKey: await loadMasterKey(store.dataDir)
    });
    const info = await stat(decryptedPath);
    const filename = decryptedFilename(normalizedRemotePath);
    return new Response(fileStreamWithCleanup(decryptedPath, tempDir), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(info.size),
        'content-disposition': contentDisposition(filename)
      }
    });
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function downloadDecryptedFolder({ store, client, remotePath }) {
  const normalizedRemotePath = normalizeRemoteFolderPath(remotePath);
  if (!client?.listEncryptedEntries || !client?.downloadFile) {
    return json({ error: 'pCloud encrypted folder download is unavailable' }, 501);
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'pcloud-decrypt-folder-'));
  const encryptedDir = path.join(tempDir, 'encrypted');
  const decryptedDir = path.join(tempDir, 'decrypted');
  const zipPath = path.join(tempDir, 'decrypted-folder.zip');
  try {
    await mkdir(encryptedDir, { recursive: true });
    await mkdir(decryptedDir, { recursive: true });
    const masterKey = await loadMasterKey(store.dataDir);
    const files = await collectEncryptedFolderFiles(client, normalizedRemotePath);
    const zipEntries = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const encryptedPath = path.join(encryptedDir, `${index}.pcenc`);
      const decryptedPath = path.join(decryptedDir, String(index));
      await client.downloadFile({
        path: file.remotePath,
        filePath: encryptedPath
      });
      await decryptFile({
        sourcePath: encryptedPath,
        targetPath: decryptedPath,
        masterKey
      });
      zipEntries.push({
        sourcePath: decryptedPath,
        archivePath: file.archivePath
      });
    }

    await writeStoredZip({ entries: zipEntries, targetPath: zipPath });
    const info = await stat(zipPath);
    const filename = decryptedFolderZipFilename(normalizedRemotePath);
    return new Response(fileStreamWithCleanup(zipPath, tempDir), {
      headers: {
        'content-type': 'application/zip',
        'content-length': String(info.size),
        'content-disposition': contentDisposition(filename)
      }
    });
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function collectEncryptedFolderFiles(client, rootPath) {
  const files = [];
  const visited = new Set();

  async function visit(remotePath, archivePrefix = '') {
    const normalized = normalizeRemoteFolderPath(remotePath);
    if (visited.has(normalized)) {
      return;
    }
    visited.add(normalized);
    const listing = await client.listEncryptedEntries(normalized);
    for (const entry of listing.entries || []) {
      if (entry.type === 'folder') {
        await visit(entry.path, joinArchivePath(archivePrefix, entry.name));
      } else if (entry.type === 'encrypted-file') {
        const name = entry.decryptedName || decryptedFilename(entry.name);
        files.push({
          remotePath: entry.path,
          archivePath: joinArchivePath(archivePrefix, name)
        });
      }
    }
  }

  await visit(rootPath);
  return files;
}

async function exportEncryptionKey(store) {
  const keyPath = path.join(store.dataDir, 'encryption.key');
  let body;
  try {
    body = await readFile(keyPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return json({ error: 'Encryption key is not configured' }, 404);
    }
    throw error;
  }
  await loadMasterKey(store.dataDir);
  return new Response(body, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
      'content-disposition': contentDisposition('encryption.key'),
      'cache-control': 'no-store'
    }
  });
}

function fileStreamWithCleanup(filePath, tempDir) {
  const source = Readable.from((async function* streamFile() {
    try {
      for await (const chunk of createReadStream(filePath)) {
        yield chunk;
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  })());
  return Readable.toWeb(source);
}

function decryptedFilename(remotePath) {
  const name = path.posix.basename(String(remotePath || 'download.pcenc'));
  return name.endsWith('.pcenc') ? name.slice(0, -'.pcenc'.length) || 'download' : name;
}

function decryptedFolderZipFilename(remotePath) {
  const name = path.posix.basename(normalizeRemoteFolderPath(remotePath));
  return `${name && name !== '/' ? name : 'pcloud-encrypted-files'}.zip`;
}

function normalizeRemoteFolderPath(remotePath) {
  const value = String(remotePath || '/').trim().replaceAll('\\', '/');
  if (!value || value === '/') {
    return '/';
  }
  const parts = value.split('/').filter(Boolean);
  return `/${parts.join('/')}`;
}

function joinArchivePath(...parts) {
  return parts
    .join('/')
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

function contentDisposition(filename) {
  const fallback = asciiFilenameFallback(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

function asciiFilenameFallback(filename) {
  const name = String(filename || 'download').replaceAll('"', '').replaceAll('\\', '').replaceAll(';', '');
  const cleaned = name.replace(/[^\x20-\x7E]/g, '').trim();
  if (cleaned && !cleaned.startsWith('.')) {
    return cleaned;
  }
  const ext = path.posix.extname(name).replace(/[^\x20-\x7E]/g, '');
  return `download${ext && ext !== '.' ? ext : ''}`;
}

function encodeRfc5987(value) {
  return encodeURIComponent(String(value || 'download'))
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A');
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
