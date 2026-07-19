import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { normalizeConfig } from '../config/config.js';
import { writeStoredZip } from '../archive/zip.js';

export class ResticService {
  constructor({
    store,
    dataDir = store?.dataDir || '/data',
    restoreRoot = process.env.RESTIC_RESTORE_ROOT || '/restore',
    allowedRoots = ['/vol1', '/vol2'],
    runCommand = defaultRunCommand,
    resticBinary = 'restic',
    backend = null,
    indexCatalog = null,
    zipBinary = 'zip'
  } = {}) {
    this.store = store;
    this.dataDir = dataDir;
    this.restoreRoot = path.resolve(restoreRoot);
    this.allowedRoots = allowedRoots.map((root) => path.resolve(root));
    this.runCommand = runCommand;
    this.resticBinary = resticBinary;
    this.backend = backend;
    this.indexCatalog = indexCatalog;
    this.zipBinary = zipBinary;
    this.timer = null;
    this.job = null;
    this.scheduleSlots = new Map();
    this.reconcileTimer = null;
  }

  async start() {
    await this.ensureDirectories();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.runDueTasks().catch((error) => this.recordError(error)), 30_000);
    this.timer.unref?.();
    if (this.indexCatalog) {
      this.reconcileTimer = setTimeout(() => this.reconcileIndexes().catch((error) => this.recordError(error)), 1_000);
      this.reconcileTimer.unref?.();
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    if (this.job?.child?.kill) this.job.child.kill('SIGTERM');
  }

  getStatus() {
    if (!this.job) return { active: false };
    const { child: _child, promise: _promise, ...status } = this.job;
    return structuredClone(status);
  }

  async taskStatuses() {
    const config = await this.config();
    return Promise.all(config.tasks.filter((task) => task.mode === 'restic').map(async (task) => ({
      taskId: task.id,
      passwordConfigured: await this.passwordConfigured(task.id),
      index: this.store.getResticIndexState ? await this.store.getResticIndexState(task.id) : { status: 'unavailable' }
    })));
  }

  async setPassword(taskId, password) {
    const task = await this.task(taskId);
    const value = String(password || '');
    if (value.length < 12) throw httpError('Restic 密码至少需要 12 个字符', 400);
    const passwordPath = this.passwordPath(task.id);
    await mkdir(path.dirname(passwordPath), { recursive: true, mode: 0o700 });
    await writeFile(passwordPath, `${value}\n`, { mode: 0o600 });
    await chmod(passwordPath, 0o600);
    return { taskId: task.id, passwordConfigured: true };
  }

  async exportRecovery(taskId) {
    const task = await this.task(taskId);
    const password = (await readFile(this.passwordPath(task.id), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') throw httpError('该任务尚未设置 Restic 密码', 404);
      throw error;
    })).trimEnd();
    return {
      filename: `${safeId(task.id)}-restic-recovery.txt`,
      content: [
        'pCloud NAS Sync Restic recovery information',
        `Task: ${task.name}`,
        `Repository: ${this.repositoryUrl(task)}`,
        `Source: ${task.localPath}`,
        `Password: ${password}`,
        '',
        'Keep this file offline. Anyone with this password and pCloud access can decrypt the backup.'
      ].join('\n')
    };
  }

  async startBackup(taskId) {
    const task = await this.task(taskId);
    return this.startJob('backup', task, async (update) => {
      const config = await this.config();
      const progressState = { samples: [], recentFiles: [], recentErrors: [] };
      update({ phase: 'checking-repository' });
      await this.ensureRepository(task, config);
      update({ phase: 'backing-up' });
      const args = ['backup', task.localPath, '--json', '--tag', `task:${task.id}`, '--host', 'fnos-pcloud-nas-sync'];
      // Restic receives exclusions only from the user-facing configuration.
      // There is deliberately no implicit file-type or filename exclude list.
      for (const pattern of unique(config.sync.ignorePatterns || [])) {
        args.push('--exclude', pattern);
      }
      let snapshotId = '';
      await this.restic(task, config, args, {
        onStdoutLine: (line) => {
          const message = parseJson(line);
          if (!message) return;
          if (message.message_type === 'status') {
            update(backupProgressPatch(message, progressState, task.localPath));
          }
          if (message.message_type === 'summary') {
            snapshotId = message.snapshot_id || '';
            update({ snapshotId, summary: message });
          }
        },
        onStderrLine: (line) => {
          const message = parseJson(line);
          if (message?.message_type === 'error') {
            update(backupErrorPatch(message, progressState, task.localPath));
          }
        }
      });
      update({ phase: 'retention' });
      await this.forget(task, config);
      let index = null;
      if (snapshotId && this.indexCatalog) {
        try {
          update({ phase: 'indexing' });
          index = await this.buildAndPublishIndex(task, config, snapshotId, update);
        } catch (error) {
          update({ indexWarning: error.message });
          await this.store.addEvent?.('restic-index-error', task.id, '备份成功，但云端目录索引更新失败', { error: error.message, snapshotId });
        }
      }
      return { message: index ? '备份、保留策略和云端加密索引处理完成' : '备份和保留策略处理完成', index };
    });
  }

  async startIndexRebuild(taskId, snapshotId = '') {
    const task = await this.task(taskId);
    return this.startJob('index', task, async (update) => {
      const config = await this.config();
      let snapshot = snapshotId ? cleanSnapshotId(snapshotId) : '';
      if (!snapshot) {
        const remote = await this.liveSnapshots(task, config);
        snapshot = remote[0]?.id || '';
      }
      if (!snapshot) throw httpError('Restic 仓库中没有可建立索引的快照', 404);
      update({ phase: 'indexing', snapshotId: snapshot });
      const result = await this.buildAndPublishIndex(task, config, snapshot, update);
      return { message: '本地目录缓存和 pCloud 加密索引已更新', index: result };
    });
  }

  async startCheck(taskId) {
    const task = await this.task(taskId);
    return this.startJob('check', task, async () => {
      const config = await this.config();
      await this.restic(task, config, ['check']);
      return { message: '仓库检查通过' };
    });
  }

  async startPrune(taskId) {
    const task = await this.task(taskId);
    return this.startJob('prune', task, async () => {
      const config = await this.config();
      await this.restic(task, config, ['prune']);
      return { message: '未引用数据清理完成' };
    });
  }

  stopJob() {
    if (!this.job?.active) return { stopping: false };
    this.job.stopping = true;
    this.job.child?.kill?.('SIGTERM');
    return { stopping: true };
  }

  async snapshots(taskId) {
    this.assertReadable();
    const task = await this.task(taskId);
    const cached = this.store.listResticSnapshotIndexes ? await this.store.listResticSnapshotIndexes(task.id) : [];
    if (cached.length) {
      this.reconcileOne(task).catch((error) => this.recordIndexError(task.id, error));
      return cached.map(normalizeSnapshot);
    }
    return this.liveSnapshots(task, await this.config());
  }

  async browse(taskId, snapshotId, relativePath = '') {
    this.assertReadable();
    const task = await this.task(taskId);
    const snapshot = cleanSnapshotId(snapshotId);
    const relative = cleanRelativePath(relativePath);
    if (this.store.getResticSnapshotIndex && await this.store.getResticSnapshotIndex(task.id, snapshot)) {
      const entries = await this.store.browseResticSnapshotIndex(task.id, snapshot, relative);
      return {
        taskId: task.id,
        snapshot,
        path: relative,
        parent: relative ? path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative) : null,
        entries: entries.map(({ parent: _parent, ...entry }) => entry)
      };
    }
    const snapshotPath = snapshotPathFor(task, relative);
    const result = await this.restic(task, await this.config(), ['ls', '--json', snapshot, snapshotPath]);
    const entries = result.stdout.split(/\r?\n/)
      .map(parseJson)
      .filter((entry) => entry?.struct_type === 'node' && entry.path !== snapshotPath)
      .map((entry) => ({
        name: entry.name || path.posix.basename(entry.path),
        path: relativeFromTask(task, entry.path),
        type: entry.type === 'dir' ? 'folder' : 'file',
        size: Number(entry.size || 0),
        mtime: entry.mtime || ''
      }));
    return {
      taskId: task.id,
      snapshot,
      path: relative,
      parent: relative ? path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative) : null,
      entries
    };
  }

  async prepareDownload(taskId, snapshotId, relativePath, { zip = false } = {}) {
    this.assertReadable();
    const task = await this.task(taskId);
    const snapshot = cleanSnapshotId(snapshotId);
    const relative = cleanRelativePath(relativePath);
    if (!relative) throw httpError('请选择要下载的文件或文件夹', 400);
    const tempDir = path.join(this.restoreRoot, '.downloads', randomUUID());
    const restoredRoot = path.join(tempDir, 'restored');
    await mkdir(restoredRoot, { recursive: true });
    try {
      const config = await this.config();
      const sourcePath = snapshotPathFor(task, relative);
      await this.restic(task, config, ['restore', snapshot, '--target', restoredRoot, '--include', sourcePath]);
      const restoredPath = path.join(restoredRoot, sourcePath.replace(/^\/+/, ''));
      const info = await stat(restoredPath);
      if (zip || info.isDirectory()) {
        const zipPath = path.join(tempDir, `${safeDownloadName(path.posix.basename(relative))}.zip`);
        await writeStoredZip({ entries: await zipEntries(restoredPath), targetPath: zipPath });
        return this.downloadResult(zipPath, tempDir, path.basename(zipPath), 'application/zip');
      }
      return this.downloadResult(restoredPath, tempDir, path.posix.basename(relative), 'application/octet-stream');
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async restoreToNas(taskId, snapshotId, relativePath = '') {
    const task = await this.task(taskId);
    const snapshot = cleanSnapshotId(snapshotId);
    const relative = cleanRelativePath(relativePath);
    const destination = path.join(this.restoreRoot, `${safeId(task.id)}-${timestampForPath()}`);
    await mkdir(destination, { recursive: true });
    const args = ['restore', snapshot, '--target', destination];
    if (relative) args.push('--include', snapshotPathFor(task, relative));
    await this.restic(task, await this.config(), args);
    return { destination, relativePath: relative };
  }

  async runDueTasks(now = new Date()) {
    if (this.job?.active) return 0;
    const config = await this.config();
    const due = config.tasks.filter((task) => task.enabled && task.mode === 'restic' && taskIsDue(task, config.sync, now, this.scheduleSlots));
    if (!due.length) return 0;
    const task = due[0];
    rememberSchedule(task, config.sync, now, this.scheduleSlots);
    await this.startBackup(task.id);
    return 1;
  }

  async reconcileIndexes() {
    if (!this.indexCatalog || this.job?.active) return [];
    const config = await this.config();
    const results = [];
    for (const task of config.tasks.filter((item) => item.mode === 'restic')) {
      try {
        results.push(await this.indexCatalog.reconcile(task, config));
      } catch (error) {
        this.recordIndexError(task.id, error);
      }
    }
    return results;
  }

  async reconcileOne(task) {
    if (!this.indexCatalog || this.job?.active) return null;
    return this.indexCatalog.reconcile(task, await this.config());
  }

  async liveSnapshots(task, config) {
    const result = await this.restic(task, config, ['snapshots', '--json', '--tag', `task:${task.id}`]);
    return JSON.parse(result.stdout || '[]').map(normalizeSnapshot);
  }

  async buildAndPublishIndex(task, config, snapshotId, update = () => {}) {
    if (!this.indexCatalog) throw new Error('快照索引服务尚未启用');
    const snapshots = await this.liveSnapshots(task, config);
    await this.store.pruneResticSnapshotIndexes?.(task.id, snapshots.map((item) => item.id));
    const snapshot = snapshots.find((item) => item.id === snapshotId || item.shortId === snapshotId.slice(0, 8));
    if (!snapshot) throw new Error(`找不到刚完成的 Restic 快照 ${snapshotId}`);
    const builder = await this.indexCatalog.createBuilder(task, snapshot);
    let localReady = false;
    try {
      await this.restic(task, config, ['ls', '--json', snapshot.id], {
        maxOutputBytes: 1024 * 1024,
        onStdoutLine: (line) => {
          builder.push(line);
        }
      });
      const local = await builder.finish();
      localReady = true;
      update({ phase: 'publishing-index', indexEntries: local.entryCount });
      const cloud = await this.indexCatalog.publish(task, snapshot.id, config);
      update({ phase: 'complete', indexEntries: local.entryCount });
      return cloud;
    } catch (error) {
      if (!localReady) await builder.abort(error);
      throw error;
    }
  }

  async ensureRepository(task, config) {
    const probe = await this.restic(task, config, ['snapshots', '--json'], { allowExitCodes: [0, 10] });
    if (probe.code === 10) {
      await this.restic(task, config, ['init', '--repository-version', '2']);
    }
  }

  async forget(task, config) {
    const policy = task.restic || {};
    const args = ['forget', '--tag', `task:${task.id}`];
    if (policy.keepDaily > 0) args.push('--keep-daily', String(policy.keepDaily));
    if (policy.keepWeekly > 0) args.push('--keep-weekly', String(policy.keepWeekly));
    if (policy.keepMonthly > 0) args.push('--keep-monthly', String(policy.keepMonthly));
    if (args.length > 3) await this.restic(task, config, args);
  }

  async restic(task, config, args, options = {}) {
    await this.ensureDirectories();
    if (!await this.passwordConfigured(task.id)) throw httpError('请先为该任务设置 Restic 密码', 400);
    const env = {
      ...process.env,
      RESTIC_REPOSITORY: this.repositoryUrl(task),
      RESTIC_PASSWORD_FILE: this.passwordPath(task.id),
      RESTIC_CACHE_DIR: path.join(this.dataDir, 'restic', 'cache', safeId(task.id)),
      RESTIC_COMPRESSION: task.restic?.compression || 'auto'
    };
    const commandArgs = ['--retry-lock', '2m', ...args];
    const result = await this.runCommand(this.resticBinary, commandArgs, {
      env,
      maxOutputBytes: options.maxOutputBytes || 64 * 1024 * 1024,
      onStdoutLine: options.onStdoutLine,
      onStderrLine: options.onStderrLine,
      onChild: (child) => {
        if (this.job?.active) this.job.child = child;
      },
      allowExitCodes: options.allowExitCodes || [0]
    });
    return result;
  }

  repositoryUrl(task) {
    if (!this.backend) throw httpError('Restic pCloud 后端尚未启动', 503);
    return this.backend.repositoryUrl(task.id);
  }

  async startJob(action, task, operation) {
    if (this.job?.active) throw httpError(`已有 ${this.job.action} 任务正在运行`, 409);
    this.job = {
      active: true,
      stopping: false,
      action,
      taskId: task.id,
      taskName: task.name,
      startedAt: new Date().toISOString(),
      percent: 0,
      filesDone: 0,
      totalFiles: 0,
      bytesDone: 0,
      totalBytes: 0,
      error: ''
    };
    const update = (patch) => Object.assign(this.job, patch);
    this.job.promise = operation(update)
      .then((result) => update({ active: false, finishedAt: new Date().toISOString(), result }))
      .catch((error) => update({ active: false, finishedAt: new Date().toISOString(), error: error.message }))
      .finally(() => { delete this.job.child; delete this.job.promise; });
    return this.getStatus();
  }

  async waitForIdle() {
    await this.job?.promise;
    return this.getStatus();
  }

  async task(taskId) {
    const id = String(taskId || '').trim();
    const task = (await this.config()).tasks.find((item) => item.id === id && item.mode === 'restic');
    if (!task) throw httpError('找不到 Restic 备份任务', 404);
    this.assertSourcePath(task.localPath);
    return task;
  }

  async config() {
    return normalizeConfig(await this.store.loadConfig() ?? {});
  }

  async passwordConfigured(taskId) {
    try {
      return (await stat(this.passwordPath(taskId))).isFile();
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  passwordPath(taskId) {
    return path.join(this.dataDir, 'restic', 'secrets', `${safeId(taskId)}.password`);
  }

  assertSourcePath(sourcePath) {
    const resolved = path.resolve(sourcePath);
    if (!this.allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
      throw httpError('备份源不在允许的 NAS 数据卷内', 403);
    }
  }

  assertReadable() {
    if (this.job?.active) throw httpError('Restic 正在执行写入操作，请稍后再浏览', 409);
  }

  async ensureDirectories() {
    await Promise.all([
      mkdir(path.join(this.dataDir, 'restic', 'secrets'), { recursive: true, mode: 0o700 }),
      mkdir(path.join(this.dataDir, 'restic', 'cache'), { recursive: true }),
      mkdir(path.join(this.restoreRoot, '.downloads'), { recursive: true })
    ]);
  }

  downloadResult(filePath, tempDir, filename, contentType) {
    return { filePath, tempDir, filename, contentType };
  }

  recordError(error) {
    if (this.job) this.job.error = error.message;
  }

  recordIndexError(taskId, error) {
    this.store.setResticIndexState?.(taskId, { status: 'error', error: error.message }).catch(() => {});
  }
}

async function zipEntries(restoredPath) {
  const info = await stat(restoredPath);
  if (info.isFile()) {
    return [{ sourcePath: restoredPath, archivePath: path.basename(restoredPath) }];
  }
  const rootName = path.basename(restoredPath);
  const entries = [];
  async function visit(directory, relative = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = path.join(relative, entry.name);
      const childPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(childPath, childRelative);
      else if (entry.isFile()) entries.push({ sourcePath: childPath, archivePath: path.posix.join(rootName, childRelative.split(path.sep).join('/')) });
    }
  }
  await visit(restoredPath);
  return entries;
}

export function fileStreamWithCleanup(filePath, tempDir) {
  const source = Readable.from((async function* () {
    try {
      for await (const chunk of createReadStream(filePath)) yield chunk;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  })());
  return Readable.toWeb(source);
}

async function defaultRunCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    options.onChild?.(child);
    const max = Number(options.maxOutputBytes || 16 * 1024 * 1024);
    let stdout = '';
    let stderr = '';
    let stdoutPending = '';
    let stderrPending = '';
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(stdout) < max) stdout += chunk;
      if (options.onStdoutLine) {
        stdoutPending += chunk;
        const lines = stdoutPending.split(/\r?\n/);
        stdoutPending = lines.pop() || '';
        for (const line of lines) options.onStdoutLine(line);
      }
    });
    child.stderr.on('data', (chunk) => {
      if (Buffer.byteLength(stderr) < max) stderr += chunk;
      if (options.onStderrLine) {
        stderrPending += chunk;
        const lines = stderrPending.split(/\r?\n/);
        stderrPending = lines.pop() || '';
        for (const line of lines) options.onStderrLine(line);
      }
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (stdoutPending && options.onStdoutLine) options.onStdoutLine(stdoutPending);
      if (stderrPending && options.onStderrLine) options.onStderrLine(stderrPending);
      const allowed = options.allowExitCodes || [0];
      if (allowed.includes(code)) return resolve({ code, stdout, stderr, signal });
      const error = new Error((stderr || stdout || `${command} exited with code ${code}`).trim());
      error.exitCode = code;
      reject(error);
    });
  });
}

function snapshotPathFor(task, relative) {
  const root = `/${task.localPath.replaceAll('\\', '/').split('/').filter(Boolean).join('/')}`;
  return relative ? `${root}/${relative}` : root;
}

function normalizeSnapshot(snapshot) {
  return {
    id: snapshot.id,
    shortId: snapshot.shortId || snapshot.short_id || String(snapshot.id || '').slice(0, 8),
    time: snapshot.time,
    hostname: snapshot.hostname,
    paths: snapshot.paths || [],
    tags: snapshot.tags || [],
    entryCount: Number(snapshot.entryCount || 0),
    indexedAt: snapshot.indexedAt || ''
  };
}

function relativeFromTask(task, snapshotPath) {
  const root = snapshotPathFor(task, '');
  return String(snapshotPath || '').slice(root.length).replace(/^\/+/, '');
}

function cleanRelativePath(value) {
  const parts = String(value || '').trim().replaceAll('\\', '/').split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw httpError('路径不能包含相对路径段', 400);
  return parts.join('/');
}

function cleanSnapshotId(value) {
  const id = String(value || '').trim();
  if (!/^(latest|[a-f0-9]{6,64})$/i.test(id)) throw httpError('快照 ID 不合法', 400);
  return id;
}

function safeId(value) {
  const id = String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return id || 'restic-task';
}

function safeDownloadName(value) {
  return String(value || 'restic-download').replace(/[\\/:*?"<>|]+/g, '-');
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseJson(line) {
  try { return JSON.parse(String(line || '')); } catch { return null; }
}

function backupProgressPatch(message, state, sourcePath) {
  const secondsElapsed = finiteNumber(message.seconds_elapsed);
  const bytesDone = finiteNumber(message.bytes_done);
  const filesDone = finiteNumber(message.files_done);
  const currentFiles = unique(Array.isArray(message.current_files) ? message.current_files : [])
    .map((item) => relativeBackupItem(item, sourcePath))
    .filter(Boolean)
    .slice(0, 12);
  for (const item of currentFiles) {
    state.recentFiles = [item, ...state.recentFiles.filter((value) => value !== item)].slice(0, 20);
  }
  if (!state.samples.length || state.samples.at(-1).secondsElapsed !== secondsElapsed) {
    state.samples.push({ secondsElapsed, bytesDone, filesDone });
    state.samples = state.samples.filter((sample) => sample.secondsElapsed >= secondsElapsed - 30);
  } else {
    state.samples[state.samples.length - 1] = { secondsElapsed, bytesDone, filesDone };
  }
  const baseline = state.samples.find((sample) => sample.secondsElapsed >= secondsElapsed - 15) || state.samples[0];
  const sampleSeconds = Math.max(0, secondsElapsed - finiteNumber(baseline?.secondsElapsed));
  const bytesPerSecond = sampleSeconds > 0 ? Math.max(0, bytesDone - finiteNumber(baseline?.bytesDone)) / sampleSeconds : 0;
  const filesPerSecond = sampleSeconds > 0 ? Math.max(0, filesDone - finiteNumber(baseline?.filesDone)) / sampleSeconds : 0;
  const resticRemaining = finiteNumber(message.seconds_remaining);
  const totalBytes = finiteNumber(message.total_bytes);
  const estimatedSecondsRemaining = resticRemaining > 0
    ? resticRemaining
    : bytesPerSecond > 0 ? Math.max(0, totalBytes - bytesDone) / bytesPerSecond : 0;
  return {
    percent: Math.round(finiteNumber(message.percent_done) * 1000) / 10,
    filesDone,
    totalFiles: finiteNumber(message.total_files),
    bytesDone,
    totalBytes,
    secondsElapsed,
    secondsRemaining: estimatedSecondsRemaining,
    bytesPerSecond,
    filesPerSecond,
    averageBytesPerSecond: secondsElapsed > 0 ? bytesDone / secondsElapsed : 0,
    errorCount: finiteNumber(message.error_count),
    currentFiles,
    recentFiles: [...state.recentFiles],
    lastActivityAt: new Date().toISOString()
  };
}

function backupErrorPatch(message, state, sourcePath) {
  const detail = {
    item: relativeBackupItem(message.item || '', sourcePath),
    message: String(message.error?.message || message.message || 'Restic backup error'),
    during: String(message.during || ''),
    at: new Date().toISOString()
  };
  state.recentErrors = [detail, ...state.recentErrors].slice(0, 10);
  return {
    errorCount: Math.max(1, finiteNumber(message.error_count)),
    recentErrors: structuredClone(state.recentErrors),
    lastActivityAt: detail.at
  };
}

function relativeBackupItem(value, sourcePath) {
  const item = String(value || '').replaceAll('\\', '/');
  const source = String(sourcePath || '').replaceAll('\\', '/').replace(/\/+$/, '');
  if (!item) return '';
  if (source && item === source) return path.posix.basename(source);
  if (source && item.startsWith(`${source}/`)) return item.slice(source.length + 1);
  return item;
}

function finiteNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function taskIsDue(task, sync, now, slots) {
  const schedule = task.schedule || { type: 'interval', intervalSeconds: sync.intervalSeconds || 300 };
  if (schedule.type === 'manual') return false;
  if (schedule.type === 'interval') {
    if (!slots.has(task.id)) {
      slots.set(task.id, now.getTime());
      return false;
    }
    const last = Number(slots.get(task.id) || 0);
    return now.getTime() - last >= Number(schedule.intervalSeconds || 300) * 1000;
  }
  const parts = zonedParts(now, sync.timezone);
  if (parts.time !== schedule.time) return false;
  if (schedule.type === 'weekly' && !(schedule.weekdays || []).includes(parts.weekday)) return false;
  return slots.get(task.id) !== `${parts.date}:${schedule.time}`;
}

function rememberSchedule(task, sync, now, slots) {
  if ((task.schedule?.type || 'interval') === 'interval') slots.set(task.id, now.getTime());
  else {
    const parts = zonedParts(now, sync.timezone);
    slots.set(task.id, `${parts.date}:${task.schedule.time}`);
  }
}

function zonedParts(date, timeZone) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  };
}
