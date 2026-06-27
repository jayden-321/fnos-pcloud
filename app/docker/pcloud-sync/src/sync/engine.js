import { createReadStream, createWriteStream, watch } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../config/config.js';
import { PCloudClient } from '../pcloud/client.js';
import { isIgnored, scanSource } from '../scanner/scanner.js';
import { planUploads } from './planner.js';

const MIN_UPLOAD_SPEED_SAMPLE_MS = 500;
const PCLOUD_DIFF_LIMIT = 1000;
const SPEED_TEST_REMOTE_PATH = '/pcloud-nas-sync-speed-test';

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
    this.currentTaskId = '';
    this.currentTaskName = '';
    this.taskQueue = [];
    this.scheduleSlots = new Map();
    this.watchers = new Map();
    this.changedFiles = new Map();
    this.changedTasks = new Set();
    this.mtimeVerificationJobs = new Map();
    this.speedTestJob = null;
  }

  getStatus() {
    return {
      running: Boolean(this.timer),
      active: this.running,
      stopping: this.stopRequested && (this.running || this.activeUploads.size > 0),
      lastRunAt: this.lastRunAt,
      lastError: this.lastError,
      currentTaskId: this.currentTaskId,
      currentTaskName: this.currentTaskName,
      taskQueue: structuredClone(this.taskQueue),
      queuedLocalChanges: this.changedFiles.size + this.changedTasks.size,
      watchers: [...this.watchers.values()].map((entry) => ({
        taskId: entry.taskId,
        path: entry.path,
        supported: entry.supported,
        error: entry.error || ''
      })),
      uploadSpeedBytesPerSecond: this.uploadSpeedBytesPerSecond(),
      activeUploads: [...this.activeUploads.entries()].map(([key, upload]) => ({
        key,
        bytes: upload.bytes,
        total: upload.total,
        updatedAt: upload.updatedAt
      })),
      mtimeVerifications: [...this.mtimeVerificationJobs.values()].map((job) => structuredClone(job)),
      speedTest: this.speedTestJob ? structuredClone(this.speedTestJob) : null
    };
  }

  async start() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    await this.refreshWatchers();
    this.timer = setInterval(() => {
      this.refreshWatchers()
        .then(() => this.runDueTasks())
        .catch((error) => {
          this.lastError = error.message;
        });
    }, 30 * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const entry of this.watchers.values()) {
      entry.watcher?.close();
    }
    this.watchers.clear();
  }

  queueLocalChange(taskId, relativePath = '') {
    const id = String(taskId || '').trim();
    if (!id) {
      return;
    }
    const relative = normalizeRelativePath(relativePath);
    if (!relative) {
      this.changedTasks.add(id);
      return;
    }
    this.changedFiles.set(`${id}/${relative}`, {
      taskId: id,
      relativePath: relative,
      at: Date.now()
    });
  }

  async refreshWatchers(config = null) {
    const normalized = config ?? normalizeConfig(await this.store.loadConfig() ?? {});
    const enabledTasks = normalized.tasks.filter((task) => task.enabled);
    const taskPaths = new Map(enabledTasks.map((task) => [task.id, path.resolve(task.localPath)]));

    for (const [taskId, entry] of this.watchers) {
      if (taskPaths.get(taskId) !== entry.path) {
        entry.watcher?.close();
        this.watchers.delete(taskId);
      }
    }

    for (const task of enabledTasks) {
      const root = path.resolve(task.localPath);
      if (this.watchers.get(task.id)?.path === root) {
        continue;
      }
      try {
        const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
          this.queueLocalChange(task.id, filename || '');
        });
        watcher.unref?.();
        this.watchers.set(task.id, {
          taskId: task.id,
          path: root,
          supported: true,
          watcher
        });
      } catch (error) {
        this.changedTasks.add(task.id);
        this.watchers.set(task.id, {
          taskId: task.id,
          path: root,
          supported: false,
          error: error.message
        });
        await this.store.addEvent('watch_failed', task.name, error.message).catch(() => {});
      }
    }
  }

  async flushLocalChanges(config = null) {
    if (this.changedFiles.size === 0) {
      return { queued: 0, ignored: 0, missing: 0, failed: 0 };
    }
    const normalized = config ?? normalizeConfig(await this.store.loadConfig() ?? {});
    const tasks = new Map(normalized.tasks.filter((task) => task.enabled).map((task) => [task.id, task]));
    const entries = [...this.changedFiles.entries()];
    const result = { queued: 0, ignored: 0, missing: 0, failed: 0 };

    for (const [changeKey, change] of entries) {
      const task = tasks.get(change.taskId);
      if (!task) {
        this.changedFiles.delete(changeKey);
        continue;
      }

      const relativePath = normalizeRelativePath(change.relativePath);
      if (!relativePath) {
        this.changedTasks.add(task.id);
        this.changedFiles.delete(changeKey);
        continue;
      }
      if (isIgnored(relativePath, path.posix.basename(relativePath), normalized.sync.ignorePatterns)) {
        result.ignored += 1;
        this.changedFiles.delete(changeKey);
        continue;
      }

      const root = path.resolve(task.localPath);
      const absolutePath = path.resolve(root, ...relativePath.split('/'));
      if (!isPathInside(absolutePath, root)) {
        result.ignored += 1;
        this.changedFiles.delete(changeKey);
        continue;
      }

      let info;
      try {
        info = await stat(absolutePath);
      } catch (error) {
        if (error.code === 'ENOENT') {
          result.missing += 1;
          this.changedFiles.delete(changeKey);
          continue;
        }
        result.failed += 1;
        await this.store.addEvent('scan_failed', absolutePath, error.message).catch(() => {});
        continue;
      }

      if (info.isDirectory()) {
        this.changedTasks.add(task.id);
        this.changedFiles.delete(changeKey);
        continue;
      }
      if (!info.isFile()) {
        result.ignored += 1;
        this.changedFiles.delete(changeKey);
        continue;
      }

      const fileKey = `${task.id}/${relativePath}`;
      const existing = await this.store.getFile(fileKey);
      await this.store.upsertFile({
        key: fileKey,
        sourceId: task.id,
        absolutePath,
        relativePath,
        remotePath: joinRemote(task.remotePath, relativePath),
        size: info.size,
        mtimeMs: Math.trunc(info.mtimeMs),
        mtime: Math.trunc(info.mtimeMs / 1000),
        status: 'pending',
        error: '',
        retryCount: existing?.retryCount ?? 0
      });
      result.queued += 1;
      this.changedFiles.delete(changeKey);
    }
    return result;
  }

  clearQueuedChangesForTasks(taskIds = null) {
    const selected = Array.isArray(taskIds) && taskIds.length > 0
      ? new Set(taskIds)
      : null;
    for (const [changeKey, change] of this.changedFiles) {
      if (!selected || selected.has(change.taskId)) {
        this.changedFiles.delete(changeKey);
      }
    }
    for (const taskId of [...this.changedTasks]) {
      if (!selected || selected.has(taskId)) {
        this.changedTasks.delete(taskId);
      }
    }
  }

  async scanNow(options = {}) {
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
      const requestedTaskIds = normalizeTaskIds(options.taskIds);
      const tasks = config.tasks
        .filter((item) => item.enabled)
        .filter((item) => requestedTaskIds.length === 0 || requestedTaskIds.includes(item.id));
      this.clearQueuedChangesForTasks(requestedTaskIds.length > 0 ? requestedTaskIds : null);
      if (tasks.length === 0) {
        await this.store.clearFiles(requestedTaskIds.length > 0 ? { sourceIds: requestedTaskIds } : {});
        this.taskQueue = [];
        return { skipped: true, reason: 'no enabled tasks' };
      }
      const client = config.pcloud.accessToken ? this.pcloudFactory(config) : null;
      const result = {
        discovered: 0,
        remoteFiles: 0,
        queued: 0,
        existing: 0,
        unchanged: 0,
        missingLocal: 0,
        uploaded: 0,
        failed: 0,
        taskResults: []
      };
      this.taskQueue = tasks.map((task) => ({
        id: task.id,
        name: task.name,
        status: 'queued',
        discovered: 0,
        remoteFiles: 0,
        existing: 0,
        queued: 0,
        uploaded: 0,
        failed: 0,
        stopped: 0,
        scanMode: ''
      }));
      const plannedKeys = new Set();
      let scanRebuildFailed = false;

      for (const source of tasks) {
        if (this.stopRequested) {
          scanRebuildFailed = true;
          break;
        }
        const taskStartedAtMs = Date.now();
        let localScanMs = 0;
        let remoteScanMs = 0;
        let diffScanMs = 0;
        this.currentTaskId = source.id;
        this.currentTaskName = source.name;
        const taskResult = this.taskQueue.find((item) => item.id === source.id);
        Object.assign(taskResult, {
          status: 'scanning',
          startedAt: new Date().toISOString()
        });
        let discovered = [];
        try {
          const startedAt = Date.now();
          discovered = await scanSource(source, config.sync.ignorePatterns);
          localScanMs = Date.now() - startedAt;
        } catch (error) {
          localScanMs = Date.now() - taskStartedAtMs;
          await this.store.addEvent('scan_failed', source.localPath, error.message);
          scanRebuildFailed = true;
          result.failed += 1;
          Object.assign(taskResult, {
            status: 'failed',
            failed: taskResult.failed + 1,
            error: error.message,
            finishedAt: new Date().toISOString()
          });
          result.taskResults.push(structuredClone(taskResult));
          continue;
        }

        const previousRemoteState = await this.store.getTaskRemoteState?.(source.id) ?? {};
        let remoteFiles = null;
        let remoteFolder = null;
        let nextDiffid = Number(previousRemoteState.diffid || 0) || null;
        const needsRemoteListing = shouldListRemoteFiles({
          source,
          discovered,
          known,
          force: options.forceRemoteScan === true
        });
        let scanMode = needsRemoteListing ? 'remote_full' : '';
        let diffTouchedTask = false;

        if (client?.diff && !needsRemoteListing) {
          try {
            const startedAt = Date.now();
            const diff = await fetchPCloudDiff(client, nextDiffid);
            diffScanMs = Date.now() - startedAt;
            scanMode = 'remote_diff';
            nextDiffid = Number(diff.diffid || nextDiffid || 0) || null;
            diffTouchedTask = diffTouchesTask(diff.entries ?? [], source, previousRemoteState, known);
          } catch (error) {
            await this.store.addEvent('remote_diff_failed', source.name, error.message);
            scanMode = 'cache';
          }
        }

        if (!scanMode) {
          scanMode = 'cache';
        }

        if (client && (needsRemoteListing || diffTouchedTask)) {
          try {
            const startedAt = Date.now();
            const remoteTree = await listRemoteTree(client, source.remotePath);
            remoteScanMs = Date.now() - startedAt;
            remoteFiles = remoteTree.files;
            remoteFolder = remoteTree.folder;
            if (client.diff && !nextDiffid) {
              const diff = await fetchPCloudDiff(client, null);
              nextDiffid = Number(diff.diffid || 0) || null;
            }
          } catch (error) {
            await this.store.addEvent('remote_scan_failed', source.name, error.message);
            scanRebuildFailed = true;
            result.failed += 1;
            Object.assign(taskResult, {
              status: 'failed',
              discovered: discovered.length,
              failed: taskResult.failed + 1,
              error: error.message,
              finishedAt: new Date().toISOString()
            });
            result.taskResults.push(structuredClone(taskResult));
            continue;
          }
        }

        const planOptions = remoteFiles ? { remoteFiles } : {};
        result.remoteFiles += remoteFiles?.size ?? 0;
        const plan = planUploads(discovered, known, planOptions);
        const existingCount = remoteFiles
          ? plan.unchanged.length
          : plan.unchanged.filter((file) => known.get(file.key)?.status === 'existing').length;
        const mtimeMismatches = remoteFiles ? countRemoteMtimeMismatches(plan.unchanged) : 0;
        result.discovered += discovered.length;
        result.queued += plan.pending.length;
        result.existing += existingCount;
        result.unchanged += plan.unchanged.length;
        result.missingLocal += plan.missingLocal.length;
        Object.assign(taskResult, {
          discovered: discovered.length,
          remoteFiles: remoteFiles?.size ?? 0,
          queued: plan.pending.length,
          existing: existingCount,
          mtimeMismatches,
          scanMode,
          localScanMs,
          remoteScanMs,
          diffScanMs
        });

        const plannedFiles = [];
        for (const file of plan.pending) {
          plannedFiles.push({
            ...file,
            status: 'pending',
            error: '',
            retryCount: known.get(file.key)?.retryCount ?? 0
          });
        }

        for (const file of plan.unchanged) {
          const existing = known.get(file.key) ?? {};
          plannedFiles.push(cachedUnchangedFile(source, file, existing, Boolean(remoteFiles)));
        }
        for (const file of plannedFiles) {
          plannedKeys.add(file.key);
        }
        await this.store.replaceFilesForSources([source.id], plannedFiles);
        await this.store.setTaskRemoteState?.(source.id, {
          remotePath: source.remotePath,
          remoteFolderId: remoteFolder?.folderid ?? previousRemoteState.remoteFolderId ?? null,
          diffid: nextDiffid ?? previousRemoteState.diffid ?? null,
          lastScanMode: scanMode,
          lastScanAt: new Date().toISOString(),
          lastFullRemoteScanAt: remoteFiles ? new Date().toISOString() : previousRemoteState.lastFullRemoteScanAt,
          lastDiscovered: discovered.length,
          lastRemoteFiles: remoteFiles?.size ?? 0,
          lastMtimeMismatches: mtimeMismatches,
          lastLocalScanMs: localScanMs,
          lastRemoteScanMs: remoteScanMs,
          lastDiffScanMs: diffScanMs
        });

        if (config.pcloud.accessToken && !this.stopRequested) {
          Object.assign(taskResult, {
            status: 'syncing'
          });
          const uploadResult = await this.processPending(config, { resetStop: false, taskId: source.id });
          result.uploaded += uploadResult.uploaded;
          result.failed += uploadResult.failed;
          result.stopped = Number(result.stopped || 0) + Number(uploadResult.stopped || 0);
          Object.assign(taskResult, {
            uploaded: uploadResult.uploaded,
            failed: taskResult.failed + uploadResult.failed,
            stopped: uploadResult.stopped ?? 0
          });
        }
        Object.assign(taskResult, {
          status: this.stopRequested || taskResult.stopped > 0
            ? 'stopped'
            : taskResult.failed > 0
              ? 'failed'
              : taskResult.queued > taskResult.uploaded
                ? 'pending'
                : 'completed',
          totalScanMs: Date.now() - taskStartedAtMs,
          finishedAt: new Date().toISOString()
        });
        result.taskResults.push(structuredClone(taskResult));
        rememberIntervalRun(this.scheduleSlots, source, config.sync, new Date());
      }

      this.lastRunAt = new Date().toISOString();
      if (requestedTaskIds.length === 0 && !scanRebuildFailed) {
        await this.store.pruneFilesExcept(plannedKeys);
      }
      const scanModes = result.taskResults.map((task) => `${task.name}:${task.scanMode || 'unknown'}`).join(', ');
      const scanTimings = result.taskResults
        .map((task) => `${task.name}:local ${task.localScanMs ?? 0}ms remote ${task.remoteScanMs ?? 0}ms diff ${task.diffScanMs ?? 0}ms total ${task.totalScanMs ?? 0}ms`)
        .join(', ');
      await this.store.addEvent('scan_completed', 'sync', `${result.discovered} discovered, ${result.remoteFiles} remote, ${result.existing} existing, ${result.uploaded} uploaded, ${result.failed} failed; scanMode ${scanModes}; timings ${scanTimings}`);
      return result;
    } catch (error) {
      this.lastError = error.message;
      await this.store.addEvent('scan_failed', 'sync', error.message);
      throw error;
    } finally {
      this.currentTaskId = '';
      this.currentTaskName = '';
      this.running = false;
    }
  }

  async runDueTasks(now = new Date()) {
    if (this.running) {
      return 0;
    }
    const config = normalizeConfig(await this.store.loadConfig() ?? {});
    await this.flushLocalChanges(config);
    const dueTasks = config.tasks.filter((task) => task.enabled && taskIsDue(task, config.sync, now, this.scheduleSlots));
    if (dueTasks.length === 0) {
      return 0;
    }

    const fullScanTasks = dueTasks.filter((task) => this.changedTasks.has(task.id) || watcherUnavailableForTask(this.watchers, task.id));
    const fullScanTaskIds = new Set(fullScanTasks.map((task) => task.id));
    const queueTasks = dueTasks.filter((task) => !fullScanTaskIds.has(task.id));
    if (fullScanTasks.length > 0) {
      const scanResult = await this.scanNow({ taskIds: fullScanTasks.map((task) => task.id), trigger: 'schedule' });
      if (scanResult?.skipped) {
        return 0;
      }
      for (const task of fullScanTasks) {
        rememberTaskScheduleSlot(this.scheduleSlots, task, config.sync, now);
      }
      if (queueTasks.length === 0) {
        return dueTasks.length;
      }
    }

    const tasksToDrain = queueTasks.length > 0 ? queueTasks : dueTasks;
    if (tasksToDrain.length === 0) {
      return dueTasks.length;
    }

    this.running = true;
    this.stopRequested = false;
    this.lastError = '';
    this.taskQueue = tasksToDrain.map((task) => ({
      id: task.id,
      name: task.name,
      status: 'queued',
      discovered: 0,
      remoteFiles: 0,
      existing: 0,
      queued: 0,
      uploaded: 0,
      failed: 0,
      stopped: 0
    }));

    let uploaded = 0;
    let failed = 0;
    let stopped = 0;
    try {
      for (const task of tasksToDrain) {
        if (this.stopRequested) {
          break;
        }
        this.currentTaskId = task.id;
        this.currentTaskName = task.name;
        const taskResult = this.taskQueue.find((item) => item.id === task.id);
        const queuedFiles = await this.store.listFiles({ sourceId: task.id, status: 'pending' });
        const uploadingFiles = await this.store.listFiles({ sourceId: task.id, status: 'uploading' });
        Object.assign(taskResult, {
          status: 'syncing',
          queued: queuedFiles.length + uploadingFiles.length,
          startedAt: new Date().toISOString()
        });
        const uploadResult = await this.processPending(config, { resetStop: false, taskId: task.id });
        uploaded += uploadResult.uploaded;
        failed += uploadResult.failed;
        stopped += uploadResult.stopped ?? 0;
        Object.assign(taskResult, {
          uploaded: uploadResult.uploaded,
          failed: uploadResult.failed,
          stopped: uploadResult.stopped ?? 0,
          status: this.stopRequested || uploadResult.stopped > 0
            ? 'stopped'
            : uploadResult.failed > 0
              ? 'failed'
              : 'completed',
          finishedAt: new Date().toISOString()
        });
        rememberTaskScheduleSlot(this.scheduleSlots, task, config.sync, now);
      }
      this.lastRunAt = new Date().toISOString();
      await this.store.addEvent('scheduled_completed', 'sync', `${tasksToDrain.length} tasks, ${uploaded} uploaded, ${failed} failed`);
      return dueTasks.length;
    } catch (error) {
      this.lastError = error.message;
      await this.store.addEvent('scheduled_failed', 'sync', error.message);
      throw error;
    } finally {
      this.currentTaskId = '';
      this.currentTaskName = '';
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

    const filter = options.taskId ? { sourceId: options.taskId } : {};
    const pending = await this.store.listFiles({ ...filter, status: 'pending' });
    const uploading = await this.store.listFiles({ ...filter, status: 'uploading' });
    const processable = dedupeByKey([...pending, ...uploading]);
    const baseClient = this.pcloudFactory(normalized);
    const client = await this.prepareUploadClient(baseClient);
    let uploaded = 0;
    let failed = 0;
    let stopped = 0;

    await runLimited(processable, normalized.sync.concurrency, async (file) => {
      if (this.stopRequested) {
        return;
      }
      try {
        const stability = await this.refreshFileBeforeUpload(file);
        if (stability.delayed) {
          await this.store.addEvent('upload_delayed', file.key, stability.reason, { size: stability.size });
          return;
        }
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
        const upload = await this.uploadFileWithFallback({
          config: normalized,
          file,
          primaryClient: client,
          fallbackClient: baseClient,
          controller
        });
        const verification = upload.verifiedAfterError ?? await this.verifySuccessfulUpload(upload.client, file, upload, normalized.sync);
        await this.store.setStatus(file.key, 'synced', {
          error: '',
          pcloudFileId: upload.pcloudFileId,
          pcloudFolderId: upload.folder?.folderid ?? null,
          pcloudPath: upload.pcloudPath,
          pcloudHash: upload.metadata?.hash === undefined || upload.metadata?.hash === null ? '' : String(upload.metadata.hash),
          checksumSha1: verification?.sha1 ?? '',
          checksumVerifiedAt: verification?.verifiedAt ?? '',
          syncedAt: new Date().toISOString()
        });
        await this.store.addEvent(upload.verifiedAfterError ? 'upload_verified_after_error' : 'upload_succeeded', file.key, upload.pcloudPath, { size: Number(file.size || 0) });
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
        const verified = await this.verifyAfterUploadError(client, file, normalized.sync).catch(() => null);
        if (verified) {
          await this.store.setStatus(file.key, 'synced', {
            error: '',
            pcloudFileId: verified.pcloudFileId,
            pcloudFolderId: verified.pcloudFolderId,
            pcloudPath: verified.pcloudPath,
            checksumSha1: verified.sha1,
            checksumVerifiedAt: verified.verifiedAt,
            syncedAt: new Date().toISOString()
          });
          await this.store.addEvent('upload_verified_after_error', file.key, verified.pcloudPath, { size: Number(file.size || 0) });
          uploaded += 1;
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

  async uploadFileWithFallback({ config, file, primaryClient, fallbackClient, controller }) {
    try {
      return await this.uploadFileOnce({ config, file, client: primaryClient, controller });
    } catch (error) {
      if (!fallbackClient || fallbackClient === primaryClient || !isTransientUploadError(error)) {
        throw error;
      }
      const verified = await this.verifyAfterUploadError(primaryClient, file, config.sync).catch(() => null);
      if (verified) {
        return {
          client: primaryClient,
          response: null,
          metadata: { fileid: verified.pcloudFileId, path: verified.pcloudPath },
          folder: { folderid: verified.pcloudFolderId },
          pcloudFileId: verified.pcloudFileId,
          pcloudPath: verified.pcloudPath,
          verifiedAfterError: verified
        };
      }
      await this.store.addEvent('server_fallback', file.key, error.message, { size: Number(file.size || 0) });
      return this.uploadFileOnce({ config, file, client: fallbackClient, controller });
    }
  }

  async refreshFileBeforeUpload(file) {
    let info;
    try {
      info = await stat(file.absolutePath);
    } catch (error) {
      return { delayed: false };
    }
    if (!info.isFile()) {
      return { delayed: false };
    }

    const size = Number(info.size || 0);
    const mtimeMs = Math.trunc(info.mtimeMs);
    const hasScanSnapshot = Number(file.mtimeMs || 0) > 0;
    if (!hasScanSnapshot) {
      return { delayed: false };
    }
    if (size === Number(file.size || 0) && mtimeMs === Number(file.mtimeMs || 0)) {
      return { delayed: false };
    }

    await this.store.upsertFile({
      ...file,
      size,
      mtimeMs,
      mtime: Math.trunc(mtimeMs / 1000),
      status: 'pending',
      error: 'File changed after scan; upload delayed'
    });
    return {
      delayed: true,
      reason: 'File changed after scan; upload delayed',
      size
    };
  }

  async uploadFileOnce({ config, file, client, controller }) {
    const progressHash = progressHashForFile(file);
    const remoteFolder = remoteFolderForFile(config, file);
    const folder = await client.ensureFolder(remoteFolder);
    const stopProgressPolling = this.startUploadProgressPolling(client, file.key, progressHash);
    let response;
    try {
      response = await client.uploadFile({
        filePath: file.absolutePath,
        filename: path.posix.basename(file.relativePath),
        folderid: folder.folderid,
        mtime: file.mtime,
        progressHash,
        renameIfExists: config.sync.renameIfExists,
        signal: controller.signal
      });
    } finally {
      stopProgressPolling();
    }
    const metadata = uploadMetadata(response);
    const pcloudFileId = response.fileids?.[0] ?? metadata?.fileid ?? null;
    const pcloudPath = metadata?.path || joinRemote(remoteFolder, path.posix.basename(file.relativePath));
    return { client, response, metadata, folder, pcloudFileId, pcloudPath };
  }

  async verifySuccessfulUpload(client, file, upload, sync) {
    if (!shouldVerifySuccessfulUpload(file, sync)) {
      return null;
    }
    return this.verifyRemoteFileChecksum(client, file, {
      fileid: upload.pcloudFileId,
      path: upload.pcloudPath
    });
  }

  async verifyAfterUploadError(client, file, sync) {
    if (sync.checksumMode !== 'failed' || !client?.stat || !client?.checksumFile) {
      return null;
    }
    const pcloudPath = file.remotePath;
    const statResult = await client.stat({ fileid: file.pcloudFileId, path: file.pcloudFileId ? '' : pcloudPath });
    const metadata = statResult.metadata ?? {};
    if (Number(metadata.size || 0) !== Number(file.size || 0)) {
      return null;
    }
    const verified = await this.verifyRemoteFileChecksum(client, file, {
      fileid: metadata.fileid,
      path: metadata.fileid ? '' : pcloudPath
    });
    return {
      ...verified,
      pcloudFileId: metadata.fileid ?? file.pcloudFileId ?? null,
      pcloudFolderId: metadata.parentfolderid ?? null,
      pcloudPath: metadata.path || pcloudPath
    };
  }

  async verifyRemoteFileChecksum(client, file, target) {
    if (!client?.checksumFile) {
      return null;
    }
    const [localSha1, remote] = await Promise.all([
      sha1File(file.absolutePath),
      client.checksumFile(target)
    ]);
    if (remote.sha1 && String(remote.sha1).toLowerCase() !== localSha1) {
      throw new Error('pCloud checksum verification failed');
    }
    return {
      sha1: remote.sha1 ? String(remote.sha1).toLowerCase() : localSha1,
      verifiedAt: new Date().toISOString(),
      metadata: remote.metadata ?? null
    };
  }

  async startSpeedTest({ sizeMb = 50 } = {}) {
    if (this.speedTestJob?.running) {
      return structuredClone(this.speedTestJob);
    }
    const job = {
      running: true,
      phase: 'starting',
      sizeMb: clampSpeedTestSize(sizeMb),
      sizeBytes: clampSpeedTestSize(sizeMb) * 1024 * 1024,
      upload: null,
      download: null,
      checksumMatched: false,
      cleanup: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: ''
    };
    this.speedTestJob = job;
    this.runSpeedTest({
      sizeMb: job.sizeMb,
      onProgress: (progress) => {
        Object.assign(job, progress, {
          running: true,
          updatedAt: new Date().toISOString()
        });
      }
    }).then((summary) => {
      Object.assign(job, summary, {
        running: false,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: ''
      });
    }).catch((error) => {
      Object.assign(job, {
        running: false,
        phase: 'failed',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: error.message
      });
      this.lastError = error.message;
    });
    return structuredClone(job);
  }

  async runSpeedTest({ sizeMb = 50, onProgress = null } = {}) {
    const config = normalizeConfig(await this.store.loadConfig() ?? {});
    if (!config.pcloud.accessToken) {
      throw new Error('pCloud access token is not configured');
    }
    const client = this.pcloudFactory(config);
    const size = clampSpeedTestSize(sizeMb);
    const sizeBytes = size * 1024 * 1024;
    const tempDir = await mkdtemp(path.join(tmpdir(), 'pcloud-speed-test-'));
    const filename = `speed-test-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`;
    const uploadPath = path.join(tempDir, filename);
    const downloadPath = path.join(tempDir, `download-${filename}`);
    let fileid = null;
    const cleanup = { localRemoved: false, remoteRemoved: false, remoteError: '' };

    try {
      onProgress?.({ phase: 'generating', sizeMb: size, sizeBytes });
      await writeRandomFile(uploadPath, sizeBytes);
      const localSha1 = await sha1File(uploadPath);

      onProgress?.({ phase: 'uploading', sizeMb: size, sizeBytes });
      const folder = await client.ensureFolder(SPEED_TEST_REMOTE_PATH);
      const uploadStartedAt = Date.now();
      const uploadResponse = await client.uploadFile({
        filePath: uploadPath,
        filename,
        folderid: folder.folderid
      });
      const uploadMs = Math.max(1, Date.now() - uploadStartedAt);
      fileid = uploadMetadata(uploadResponse)?.fileid ?? uploadResponse?.fileids?.[0] ?? null;

      onProgress?.({ phase: 'downloading', sizeMb: size, sizeBytes });
      const downloadStartedAt = Date.now();
      const download = await client.downloadFile({ fileid, filePath: downloadPath });
      const downloadMs = Math.max(1, Date.now() - downloadStartedAt);
      const downloadSha1 = await sha1File(downloadPath);

      const summary = {
        running: false,
        phase: 'completed',
        sizeMb: size,
        sizeBytes,
        remotePath: `${SPEED_TEST_REMOTE_PATH}/${filename}`,
        upload: speedMetric(sizeBytes, uploadMs),
        download: speedMetric(download.bytes || sizeBytes, downloadMs),
        checksumMatched: localSha1 === downloadSha1,
        cleanup
      };

      if (fileid && client.deleteFile) {
        try {
          await client.deleteFile({ fileid });
          cleanup.remoteRemoved = true;
        } catch (error) {
          cleanup.remoteError = error.message;
        }
      }
      return summary;
    } finally {
      if (fileid && client.deleteFile && !cleanup.remoteRemoved) {
        await client.deleteFile({ fileid }).then(() => {
          cleanup.remoteRemoved = true;
        }).catch((error) => {
          cleanup.remoteError = error.message;
        });
      }
      await rm(tempDir, { recursive: true, force: true }).then(() => {
        cleanup.localRemoved = true;
      }).catch(() => {});
    }
  }

  async verifyMtimeMismatchSample({ taskId = '', limit = 20 } = {}) {
    return this.verifyMtimeMismatches({ taskId, limit, concurrency: 1 });
  }

  async startMtimeMismatchVerification({ taskId = '' } = {}) {
    const normalizedTaskId = String(taskId || '').trim();
    const jobKey = normalizedTaskId || 'all';
    const existing = this.mtimeVerificationJobs.get(jobKey);
    if (existing?.running) {
      return structuredClone(existing);
    }

    const job = {
      running: true,
      paused: false,
      stopRequested: false,
      phase: 'verifying',
      taskId: normalizedTaskId,
      totalCandidates: 0,
      checked: 0,
      matched: 0,
      mismatched: 0,
      failed: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: ''
    };
    this.mtimeVerificationJobs.set(jobKey, job);

    this.verifyMtimeMismatches({
      taskId: normalizedTaskId,
      stopSignal: job,
      onProgress: (progress) => {
        Object.assign(job, progress, {
          running: true,
          phase: job.stopRequested ? 'pausing' : progress.phase || 'verifying',
          updatedAt: new Date().toISOString()
        });
      }
    }).then((summary) => {
      Object.assign(job, summary, {
        running: false,
        paused: summary.paused === true,
        phase: summary.paused === true ? 'paused' : 'completed',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: ''
      });
    }).catch((error) => {
      Object.assign(job, {
        running: false,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: error.message
      });
      this.lastError = error.message;
    });

    return structuredClone(job);
  }

  async stopMtimeMismatchVerification({ taskId = '' } = {}) {
    const normalizedTaskId = String(taskId || '').trim();
    const jobKey = normalizedTaskId || 'all';
    const job = this.mtimeVerificationJobs.get(jobKey);
    if (!job) {
      return { running: false, paused: false, taskId: normalizedTaskId };
    }
    job.stopRequested = true;
    job.phase = job.running ? 'pausing' : 'paused';
    job.updatedAt = new Date().toISOString();
    return structuredClone({
      ...job,
      paused: true
    });
  }

  async verifyMtimeMismatches({ taskId = '', limit = 0, concurrency = 0, onProgress = null, stopSignal = null } = {}) {
    const config = normalizeConfig(await this.store.loadConfig() ?? {});
    const normalizedTaskId = String(taskId || '').trim();
    const maxItems = Math.max(0, Number(limit || 0));
    const workerCount = Math.max(1, Math.min(10, Number(concurrency || config.sync.mtimeVerifyConcurrency || 3)));
    const client = config.pcloud.accessToken ? this.pcloudFactory(config) : null;
    if (!client?.checksumFile) {
      return { skipped: true, reason: 'pCloud checksumfile unavailable', totalCandidates: 0, checked: 0, matched: 0, mismatched: 0, failed: 0, results: [] };
    }

    const filter = { status: 'existing' };
    if (normalizedTaskId) {
      filter.sourceId = normalizedTaskId;
    }
    const candidates = (await this.store.listFiles(filter))
      .filter((file) => file.mtimeMismatch === true)
      .filter((file) => file.mtimeMismatchStatus !== 'matched')
      .filter((file) => file.absolutePath && (file.pcloudFileId || file.pcloudPath || file.remotePath))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
    const selected = maxItems > 0 ? candidates.slice(0, maxItems) : candidates;
    const summary = {
      skipped: false,
      taskId: normalizedTaskId,
      totalCandidates: candidates.length,
      selected: selected.length,
      concurrency: workerCount,
      checked: 0,
      matched: 0,
      mismatched: 0,
      failed: 0,
      paused: false,
      phase: 'verifying',
      results: []
    };
    onProgress?.(summary);

    await runLimitedWhile(selected, workerCount, () => stopSignal?.stopRequested === true, async (file) => {
      const target = {
        fileid: file.pcloudFileId,
        path: file.pcloudFileId ? '' : file.pcloudPath || file.remotePath
      };
      try {
        const verification = await this.verifyRemoteFileChecksum(client, file, target);
        const result = {
          key: file.key,
          status: 'matched',
          sha1: verification?.sha1 ?? '',
          verifiedAt: verification?.verifiedAt ?? new Date().toISOString()
        };
        await this.store.setStatus(file.key, file.status, {
          checksumSha1: result.sha1,
          checksumVerifiedAt: result.verifiedAt,
          checksumSampleStatus: 'matched',
          mtimeMismatchVerified: true,
          mtimeMismatchVerifiedAt: result.verifiedAt,
          mtimeMismatchStatus: 'matched',
          mtimeMismatchError: ''
        });
        summary.checked += 1;
        summary.matched += 1;
        pushLimited(summary.results, result);
      } catch (error) {
        const isMismatch = /checksum verification failed/i.test(error.message || '');
        const verifiedAt = new Date().toISOString();
        const result = {
          key: file.key,
          status: isMismatch ? 'mismatched' : 'failed',
          error: error.message,
          verifiedAt
        };
        await this.store.setStatus(file.key, file.status, {
          checksumSampleStatus: result.status,
          checksumSampleError: error.message,
          checksumVerifiedAt: verifiedAt,
          mtimeMismatchVerified: isMismatch,
          mtimeMismatchVerifiedAt: isMismatch ? verifiedAt : '',
          mtimeMismatchStatus: result.status,
          mtimeMismatchError: error.message
        });
        summary.checked += 1;
        if (isMismatch) {
          summary.mismatched += 1;
        } else {
          summary.failed += 1;
        }
        pushLimited(summary.results, result);
      }
      onProgress?.(summary);
    });
    if (stopSignal?.stopRequested === true) {
      summary.paused = true;
      summary.phase = 'paused';
    }

    await this.store.addEvent('mtime_mismatch_verified', normalizedTaskId || 'all', `${summary.checked}/${summary.totalCandidates} checked, ${summary.matched} matched, ${summary.mismatched} mismatched, ${summary.failed} failed`);
    return summary;
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

function shouldListRemoteFiles({ source, discovered, known, force = false }) {
  if (discovered.length === 0) {
    return false;
  }
  if (force) {
    return true;
  }

  const taskFiles = knownFilesForTask(known, source.id);
  if (taskFiles.length === 0) {
    return true;
  }

  return taskFiles.some((file) => {
    if (!file.relativePath) {
      return true;
    }
    const expectedRemotePath = joinRemote(source.remotePath, file.relativePath);
    return String(file.remotePath || '') !== expectedRemotePath;
  });
}

async function listRemoteTree(client, remotePath) {
  if (client.listRemoteTree) {
    return client.listRemoteTree(remotePath);
  }
  if (client.listRemoteFiles) {
    return { folder: null, files: await client.listRemoteFiles(remotePath) };
  }
  return { folder: null, files: new Map() };
}

async function fetchPCloudDiff(client, diffid) {
  let cursor = Number(diffid || 0) || null;
  let latestDiffid = cursor;
  const entries = [];

  while (true) {
    const params = cursor ? { diffid: cursor, limit: PCLOUD_DIFF_LIMIT } : { last: 0 };
    const response = await client.diff(params);
    const pageEntries = Array.isArray(response.entries) ? response.entries : [];
    entries.push(...pageEntries);
    latestDiffid = Number(response.diffid || latestDiffid || 0) || null;
    if (pageEntries.length < PCLOUD_DIFF_LIMIT || !latestDiffid || latestDiffid === cursor) {
      return { ...response, diffid: latestDiffid, entries };
    }
    cursor = latestDiffid;
  }
}

function diffTouchesTask(entries, source, remoteState, known) {
  const remotePath = joinRemote(source.remotePath);
  const remoteFolderId = Number(remoteState.remoteFolderId || 0);
  const knownFileIds = new Set(
    knownFilesForTask(known, source.id)
      .map((file) => Number(file.pcloudFileId || 0))
      .filter(Boolean)
  );

  return entries.some((entry) => {
    const metadata = entry?.metadata ?? {};
    const pathValue = metadata.path ? joinRemote(metadata.path) : '';
    if (pathValue && (pathValue === remotePath || pathValue.startsWith(`${remotePath}/`))) {
      return true;
    }
    const parentFolderId = Number(metadata.parentfolderid || metadata.folderid || 0);
    if (remoteFolderId && parentFolderId === remoteFolderId) {
      return true;
    }
    const fileId = Number(metadata.fileid || 0);
    return Boolean(fileId && knownFileIds.has(fileId));
  });
}

function knownFilesForTask(known, taskId) {
  return [...known.entries()]
    .filter(([key, file]) => file?.sourceId === taskId || String(key).startsWith(`${taskId}/`))
    .map(([, file]) => file);
}

function countRemoteMtimeMismatches(files) {
  return files.filter((file) => remoteMtimeDiffers(file)).length;
}

function remoteMtimeDiffers(file) {
  const localMtime = Number(file.mtimeMs || 0);
  const remoteMtime = Number(file.remote?.mtimeMs || 0);
  return Number.isFinite(localMtime)
    && Number.isFinite(remoteMtime)
    && localMtime > 0
    && remoteMtime > 0
    && Math.abs(localMtime - remoteMtime) > 2000;
}

function cachedUnchangedFile(source, file, existing, remoteListed) {
  if (remoteListed) {
    return {
      ...file,
      status: 'existing',
      error: '',
      retryCount: existing.retryCount ?? 0,
      pcloudFileId: file.remote?.fileid ?? existing.pcloudFileId ?? null,
      pcloudFolderId: file.remote?.parentfolderid ?? existing.pcloudFolderId ?? null,
      pcloudPath: joinRemote(source.remotePath, file.relativePath),
      pcloudHash: file.remote?.hash ?? existing.pcloudHash ?? '',
      pcloudMtimeMs: file.remote?.mtimeMs ?? existing.pcloudMtimeMs ?? 0,
      mtimeMismatch: remoteMtimeDiffers(file),
      existingAt: new Date().toISOString()
    };
  }

  const status = existing.status === 'existing' ? 'existing' : 'synced';
  return {
    ...existing,
    ...file,
    status,
    error: '',
    retryCount: existing.retryCount ?? 0,
    pcloudFileId: existing.pcloudFileId ?? null,
    pcloudFolderId: existing.pcloudFolderId ?? null,
    pcloudHash: existing.pcloudHash ?? '',
    pcloudPath: existing.pcloudPath ?? joinRemote(source.remotePath, file.relativePath)
  };
}

function normalizeRelativePath(value) {
  const raw = String(value || '').replaceAll('\\', '/').trim();
  if (!raw) {
    return '';
  }
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    return '';
  }
  return parts.join('/');
}

function isPathInside(target, root) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function watcherUnavailableForTask(watchers, taskId) {
  const entry = watchers.get(taskId);
  return Boolean(entry && entry.supported === false);
}

function normalizeTaskIds(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (value) {
    return [String(value).trim()].filter(Boolean);
  }
  return [];
}

function taskIsDue(task, sync, now, slots) {
  const schedule = effectiveSchedule(task, sync);
  if (schedule.type === 'manual') {
    return false;
  }
  if (schedule.type === 'interval') {
    const last = slots.get(task.id);
    const intervalMs = Number(schedule.intervalSeconds || sync.intervalSeconds || 300) * 1000;
    return !last?.at || now.getTime() - Number(last.at) >= intervalMs;
  }
  const slot = scheduleSlot(schedule, now, sync.timezone);
  return Boolean(slot) && slots.get(task.id)?.slot !== slot;
}

function rememberTaskScheduleSlot(slots, task, sync, now) {
  const schedule = effectiveSchedule(task, sync);
  if (schedule.type === 'manual') {
    return;
  }
  slots.set(task.id, {
    slot: schedule.type === 'interval' ? `interval:${Math.floor(now.getTime() / 1000)}` : scheduleSlot(schedule, now, sync.timezone),
    at: now.getTime()
  });
}

function rememberIntervalRun(slots, task, sync, now) {
  const schedule = effectiveSchedule(task, sync);
  if (schedule.type === 'interval') {
    rememberTaskScheduleSlot(slots, task, sync, now);
  }
}

function effectiveSchedule(task, sync) {
  return task.schedule ?? {
    type: 'interval',
    intervalSeconds: Number(sync.intervalSeconds || 300)
  };
}

function scheduleSlot(schedule, now, timeZone) {
  const parts = zonedScheduleParts(now, timeZone);
  const time = String(schedule.time || '').trim();
  if (time !== `${parts.hour}:${parts.minute}`) {
    return '';
  }
  if (schedule.type === 'weekly') {
    const weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays : [];
    if (!weekdays.includes(parts.weekday)) {
      return '';
    }
  }
  return `${schedule.type}:${parts.dateKey}:${time}`;
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Resolve the wall-clock hour/minute/weekday/date for `now` in the configured
// time zone. Uses Intl (bundled ICU) so named zones work without the OS tzdata
// package, which the node:alpine base image does not ship.
function zonedScheduleParts(now, timeZone) {
  const map = {};
  for (const part of formatScheduleParts(now, timeZone)) {
    map[part.type] = part.value;
  }
  return {
    hour: map.hour === '24' ? '00' : map.hour,
    minute: map.minute,
    weekday: WEEKDAY_INDEX[map.weekday] ?? now.getDay(),
    dateKey: `${map.year}-${map.month}-${map.day}`
  };
}

function formatScheduleParts(now, timeZone) {
  const options = {
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  };
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timeZone || 'UTC', ...options }).formatToParts(now);
  } catch {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).formatToParts(now);
  }
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

async function runLimitedWhile(items, limit, shouldStop, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length || 1)) }, async () => {
    while (queue.length > 0 && !shouldStop()) {
      const item = queue.shift();
      if (!item) {
        return;
      }
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

function uploadMetadata(response) {
  const metadata = response?.metadata;
  return Array.isArray(metadata) ? metadata[0] ?? null : metadata ?? null;
}

function shouldVerifySuccessfulUpload(file, sync) {
  if (sync.checksumMode === 'all') {
    return true;
  }
  if (sync.checksumMode === 'sample') {
    return stablePercent(file.key) < Number(sync.checksumSamplePercent || 0);
  }
  return false;
}

function stablePercent(value) {
  const hash = createHash('sha1').update(String(value || '')).digest();
  return hash[0] % 100;
}

function clampSpeedTestSize(value) {
  return Math.max(1, Math.min(1024, Math.trunc(Number(value || 50))));
}

async function writeRandomFile(filePath, sizeBytes) {
  await new Promise((resolve, reject) => {
    const stream = createWriteStream(filePath);
    let remaining = Number(sizeBytes || 0);
    stream.on('error', reject);
    stream.on('finish', resolve);

    function writeMore() {
      while (remaining > 0) {
        const chunkSize = Math.min(1024 * 1024, remaining);
        remaining -= chunkSize;
        if (!stream.write(randomBytes(chunkSize))) {
          stream.once('drain', writeMore);
          return;
        }
      }
      stream.end();
    }

    writeMore();
  });
}

function speedMetric(bytes, durationMs) {
  const elapsedMs = Math.max(1, Number(durationMs || 0));
  const byteCount = Number(bytes || 0);
  return {
    bytes: byteCount,
    durationMs: elapsedMs,
    bytesPerSecond: Math.round(byteCount / (elapsedMs / 1000))
  };
}

function pushLimited(items, item, limit = 100) {
  if (items.length < limit) {
    items.push(item);
  }
}

async function sha1File(filePath) {
  const hash = createHash('sha1');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function isTransientUploadError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED'].includes(code)
    || message.includes('socket hang up')
    || message.includes('network');
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
