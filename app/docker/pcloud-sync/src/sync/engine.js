import path from 'node:path';
import { normalizeConfig } from '../config/config.js';
import { PCloudClient } from '../pcloud/client.js';
import { scanSource } from '../scanner/scanner.js';
import { planUploads } from './planner.js';

const MIN_UPLOAD_SPEED_SAMPLE_MS = 500;

export class SyncEngine {
  constructor({ store, pcloudFactory } = {}) {
    this.store = store;
    this.pcloudFactory = pcloudFactory ?? ((config) => new PCloudClient(config.pcloud));
    this.timer = null;
    this.running = false;
    this.lastRunAt = null;
    this.lastError = '';
    this.activeUploads = new Map();
    this.stopRequested = false;
  }

  getStatus() {
    return {
      running: Boolean(this.timer),
      active: this.running,
      stopping: this.stopRequested && (this.running || this.activeUploads.size > 0),
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      uploadSpeedBytesPerSecond: this.uploadSpeedBytesPerSecond(),
      activeUploads: [...this.activeUploads.entries()].map(([key, upload]) => ({
        key,
        bytes: upload.bytes,
        total: upload.total,
        updatedAt: upload.updatedAt
      }))
    };
  }

  async start() {
    const config = normalizeConfig(await this.store.loadConfig() ?? {});
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      this.scanNow().catch((error) => {
        this.lastError = error.message;
      });
    }, config.sync.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scanNow() {
    if (this.running) {
      return { skipped: true, reason: 'scan already running' };
    }
    this.running = true;
    this.stopRequested = false;
    this.lastError = '';

    try {
      const config = normalizeConfig(await this.store.loadConfig() ?? {});
      await this.store.resetUploading();
      const known = await this.store.fileMap();
      const activeKeys = new Set();
      const client = config.pcloud.accessToken ? this.pcloudFactory(config) : null;
      const result = {
        discovered: 0,
        queued: 0,
        unchanged: 0,
        missingLocal: 0,
        uploaded: 0,
        failed: 0
      };

      for (const source of config.tasks.filter((item) => item.enabled)) {
        if (this.stopRequested) {
          break;
        }
        let discovered = [];
        try {
          discovered = await scanSource(source, config.sync.ignorePatterns);
        } catch (error) {
          await this.store.addEvent('scan_failed', source.localPath, error.message);
          result.failed += 1;
          continue;
        }

        for (const file of discovered) {
          activeKeys.add(file.key);
        }

        let remoteFiles = null;
        if (client?.listRemoteFiles) {
          try {
            remoteFiles = await client.listRemoteFiles(source.remotePath);
          } catch (error) {
            await this.store.addEvent('remote_scan_failed', source.name, error.message);
            result.failed += 1;
            continue;
          }
        }

        const planOptions = remoteFiles ? { remoteFiles } : {};
        const plan = planUploads(discovered, known, planOptions);
        result.discovered += discovered.length;
        result.queued += plan.pending.length;
        result.unchanged += plan.unchanged.length;
        result.missingLocal += plan.missingLocal.length;

        for (const file of plan.pending) {
          await this.store.upsertFile({
            ...file,
            status: 'pending',
            error: '',
            retryCount: known.get(file.key)?.retryCount ?? 0
          });
        }

        if (remoteFiles) {
          for (const file of plan.unchanged) {
            const existing = known.get(file.key) ?? {};
            await this.store.upsertFile({
              ...file,
              status: 'synced',
              error: '',
              retryCount: existing.retryCount ?? 0,
              pcloudFileId: file.remote?.fileid ?? existing.pcloudFileId ?? null,
              pcloudPath: joinRemote(source.remotePath, file.relativePath),
              syncedAt: existing.syncedAt ?? new Date().toISOString()
            });
          }
        }
      }

      await this.store.pruneFilesExcept(activeKeys);

      if (config.pcloud.accessToken && !this.stopRequested) {
        const uploadResult = await this.processPending(config, { resetStop: false });
        result.uploaded += uploadResult.uploaded;
        result.failed += uploadResult.failed;
        result.stopped = uploadResult.stopped;
      }

      this.lastRunAt = new Date().toISOString();
      await this.store.addEvent('scan_completed', 'sync', `${result.discovered} discovered, ${result.uploaded} uploaded, ${result.failed} failed`);
      return result;
    } catch (error) {
      this.lastError = error.message;
      await this.store.addEvent('scan_failed', 'sync', error.message);
      throw error;
    } finally {
      this.running = false;
    }
  }

  async retryFailed() {
    const failed = await this.store.resetFailed();
    const uploading = await this.store.resetUploading();
    const count = failed + uploading;
    if (count > 0) {
      await this.store.addEvent('retry_queued', 'failed files', `${count} files queued`);
    }
    return count;
  }

  async requestStop() {
    this.stopRequested = true;
    const activeUploads = this.activeUploads.size;
    for (const upload of this.activeUploads.values()) {
      upload.controller?.abort();
    }
    if (activeUploads === 0) {
      await this.store.resetUploading?.();
    }
    return {
      stopping: this.running || activeUploads > 0,
      activeUploads
    };
  }

  async processPending(config = null, options = {}) {
    if (options.resetStop !== false) {
      this.stopRequested = false;
    }
    const normalized = config ?? normalizeConfig(await this.store.loadConfig() ?? {});
    if (!normalized.pcloud.accessToken) {
      return { uploaded: 0, failed: 0, stopped: 0 };
    }

    const pending = await this.store.listFiles({ status: 'pending' });
    const uploading = await this.store.listFiles({ status: 'uploading' });
    const processable = dedupeByKey([...pending, ...uploading]);
    const client = await this.prepareUploadClient(this.pcloudFactory(normalized));
    let uploaded = 0;
    let failed = 0;
    let stopped = 0;

    await runLimited(processable, normalized.sync.concurrency, async (file) => {
      if (this.stopRequested) {
        return;
      }
      try {
        await this.store.setStatus(file.key, 'uploading');
        const controller = new AbortController();
        this.activeUploads.set(file.key, {
          bytes: 0,
          total: Number(file.size || 0),
          lastBytes: 0,
          lastAt: Date.now(),
          speed: 0,
          hasProgressSample: false,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          controller
        });
        const progressHash = progressHashForFile(file);
        const stopProgressPolling = this.startUploadProgressPolling(client, file.key, progressHash);
        const remoteFolder = remoteFolderForFile(normalized, file);
        const folder = await client.ensureFolder(remoteFolder);
        let response;
        try {
          response = await client.uploadFile({
            filePath: file.absolutePath,
            filename: path.posix.basename(file.relativePath),
            folderid: folder.folderid,
            mtime: file.mtime,
            progressHash,
            signal: controller.signal
          });
        } finally {
          stopProgressPolling();
        }
        const pcloudPath = joinRemote(remoteFolder, path.posix.basename(file.relativePath));
        await this.store.setStatus(file.key, 'synced', {
          error: '',
          pcloudFileId: response.fileids?.[0] ?? response.metadata?.[0]?.fileid ?? null,
          pcloudPath,
          syncedAt: new Date().toISOString()
        });
        await this.store.addEvent('upload_succeeded', file.key, pcloudPath, { size: Number(file.size || 0) });
        uploaded += 1;
      } catch (error) {
        if (this.stopRequested || isStopError(error)) {
          await this.store.setStatus(file.key, 'pending', {
            error: 'Stopped'
          });
          await this.store.addEvent('upload_stopped', file.key, 'Stopped', { size: Number(file.size || 0) });
          stopped += 1;
          return;
        }
        await this.store.setStatus(file.key, 'failed', {
          error: error.message,
          retryCount: Number(file.retryCount || 0) + 1
        });
        await this.store.addEvent('upload_failed', file.key, error.message, { size: Number(file.size || 0) });
        failed += 1;
      } finally {
        this.activeUploads.delete(file.key);
      }
    });

    return { uploaded, failed, stopped };
  }

  recordUploadProgress(key, chunkBytes, totalBytes = 0) {
    const now = Date.now();
    const current = this.activeUploads.get(key) ?? {
      bytes: 0,
      total: Number(totalBytes || 0),
      startedAt: now,
      updatedAt: now
    };
    current.bytes += Number(chunkBytes || 0);
    current.total = Number(totalBytes || current.total || 0);
    current.updatedAt = now;
    this.activeUploads.set(key, current);
  }

  async prepareUploadClient(client) {
    let selected = client;

    if (selected.getApiServer && selected.withHostname) {
      try {
        const apiServer = await selected.getApiServer();
        const hostname = firstApiHostname(apiServer);
        if (hostname) {
          selected = selected.withHostname(hostname);
        }
      } catch {
        // Fall back to configured API host if getapiserver is unavailable.
      }
    }

    if (!selected.currentServer || !selected.withHostname) {
      return selected;
    }
    try {
      const server = await selected.currentServer();
      if (server.hostname) {
        return selected.withHostname(server.hostname);
      }
    } catch {
      // Fall back to configured API host if currentserver is unavailable.
    }
    return selected;
  }

  startUploadProgressPolling(client, key, progressHash) {
    if (!client.uploadProgress) {
      return () => {};
    }

    let stopped = false;
    const poll = async () => {
      if (stopped) {
        return;
      }
      try {
        const progress = await client.uploadProgress(progressHash);
        this.recordUploadProgressFromApi(key, progress);
      } catch {
        // pCloud may report no progress before uploadfile registers the hash.
      }
    };
    const timer = setInterval(poll, 1000);
    timer.unref?.();
    poll();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  recordUploadProgressFromApi(key, progress) {
    const now = Date.now();
    const uploaded = Number(progress?.currentfileuploaded ?? progress?.uploaded ?? 0);
    const total = Number(progress?.currentfilesize ?? progress?.total ?? 0);
    const current = this.activeUploads.get(key) ?? {
      bytes: 0,
      total,
      lastBytes: 0,
      lastAt: now,
      speed: 0,
      hasProgressSample: false,
      startedAt: now,
      updatedAt: now
    };
    const elapsedMs = Math.max(0, now - Number(current.lastAt || now));
    const delta = Math.max(0, uploaded - Number(current.lastBytes || 0));
    current.bytes = uploaded;
    current.total = total || current.total;
    if (!current.hasProgressSample || elapsedMs < MIN_UPLOAD_SPEED_SAMPLE_MS) {
      current.speed = Number(current.speed || 0);
      current.hasProgressSample = true;
    } else {
      current.speed = Math.round(delta / (elapsedMs / 1000));
    }
    current.lastBytes = uploaded;
    current.lastAt = now;
    current.updatedAt = now;
    this.activeUploads.set(key, current);
  }

  uploadSpeedBytesPerSecond() {
    let speed = 0;
    for (const upload of this.activeUploads.values()) {
      speed += Number(upload.speed || 0);
    }
    return Math.round(speed);
  }
}

function joinRemote(...parts) {
  const joined = parts
    .join('/')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}

function remoteFolderForFile(_config, file) {
  const remotePath = joinRemote(file.remotePath || '');
  return path.posix.dirname(remotePath);
}

async function runLimited(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function isStopError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR' || /upload stopped/i.test(error?.message || '');
}

function dedupeByKey(files) {
  return [...new Map(files.map((file) => [file.key, file])).values()];
}

function progressHashForFile(file) {
  return `pcloud-nas-sync-${Buffer.from(file.key).toString('base64url').slice(0, 80)}-${Date.now()}`;
}

function firstApiHostname(response) {
  const candidates = [];
  for (const key of ['api', 'hostname', 'host']) {
    const value = response?.[key];
    if (Array.isArray(value)) {
      candidates.push(...value);
    } else if (value) {
      candidates.push(value);
    }
  }
  return candidates.map((value) => String(value).trim()).find(Boolean) || '';
}
