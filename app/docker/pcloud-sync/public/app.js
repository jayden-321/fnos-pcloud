import { eventToLogRow, fileLogEvents, uploadToLogRow } from './logRows.js';
import { taskStatusText } from './taskStatus.js';

const TOKEN_MASK = '******';
const form = document.querySelector('#settingsForm');
const toast = document.querySelector('#toast');
const taskEditors = document.querySelector('#taskEditors');
const taskCards = document.querySelector('#taskCards');
const folderDialog = document.querySelector('#folderDialog');
const mtimeDetailsDialog = document.querySelector('#mtimeDetailsDialog');
let currentConfig = null;
let currentStatus = null;
let currentEvents = [];
let folderPicker = null;

const decryptBrowser = {
  path: '/',
  parent: '/',
  loaded: false,
  entries: []
};

const fields = {
  hostname: form.elements.hostname,
  clientId: form.elements.clientId,
  clientSecret: form.elements.clientSecret,
  oauthCode: form.elements.oauthCode,
  accessToken: form.elements.accessToken,
  concurrency: form.elements.concurrency,
  renameIfExists: form.elements.renameIfExists,
  checksumMode: form.elements.checksumMode,
  checksumSamplePercent: form.elements.checksumSamplePercent,
  mtimeVerifyConcurrency: form.elements.mtimeVerifyConcurrency,
  encryptionEnabled: form.elements.encryptionEnabled,
  timezone: form.elements.timezone,
  logRetentionDays: form.elements.logRetentionDays,
  logRetentionCount: form.elements.logRetentionCount,
  ignorePatterns: form.elements.ignorePatterns
};

const eventFilters = {
  task: document.querySelector('#eventTaskFilter'),
  status: document.querySelector('#eventStatusFilter'),
  search: document.querySelector('#eventSearch')
};

const decryptControls = {
  path: document.querySelector('#decryptPath'),
  rows: document.querySelector('#decryptRows'),
  up: document.querySelector('#decryptUp'),
  refresh: document.querySelector('#decryptRefresh')
};

for (const control of Object.values(eventFilters)) {
  control.addEventListener('input', renderEvents);
  control.addEventListener('change', renderEvents);
}

for (const button of document.querySelectorAll('[data-tab]')) {
  button.addEventListener('click', () => showTab(button.dataset.tab));
}

document.body.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (button && !button.classList.contains('nav-item')) {
    showTab(button.dataset.tab);
  }
});

document.body.addEventListener('change', (event) => {
  const menu = event.target.closest('select[data-action="mtime-menu"]');
  if (!menu) {
    return;
  }
  handleMtimeMenu(menu);
});

document.body.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-mtime-resolution]');
  if (!button) {
    return;
  }
  await resolveMtimeMismatch(button);
});

document.querySelector('#createTask').addEventListener('click', () => {
  addTaskEditor();
  showTab('settings');
});

document.querySelector('#addTask').addEventListener('click', addTaskEditor);

document.querySelector('#scanNow').addEventListener('click', () => runScan({ forceRemoteScan: false }));
document.querySelector('#forceRemoteScan').addEventListener('click', () => runScan({ forceRemoteScan: true }));

document.querySelector('#stopSync').addEventListener('click', async () => {
  const result = await post('/api/stop', {});
  await refreshStatus();
  show(result.stopping ? '正在停止同步' : '没有正在运行的同步');
});

document.querySelector('#retryFailed').addEventListener('click', async () => {
  const result = await post('/api/retry-failed', {});
  await refreshStatus();
  show(`${result.queued} 个已入队，${result.uploaded || 0} 个已上传，${result.failed || 0} 个失败`);
});

document.querySelector('#startSpeedTest').addEventListener('click', async () => {
  const sizeMb = Number(document.querySelector('#speedTestSize').value || 50);
  const result = await post('/api/speed-test', { sizeMb });
  await refreshStatus();
  show(result.running ? '测速已开始' : '测速完成');
});

document.querySelector('#clearEvents').addEventListener('click', async () => {
  const result = await del('/api/events');
  currentEvents = [];
  updateTaskOptions([]);
  renderEvents();
  show(`已删除 ${result.deleted} 条日志`);
});

document.querySelector('#exchangeCode').addEventListener('click', async () => {
  await saveConfig();
  await post('/api/oauth/exchange', { code: fields.oauthCode.value.trim() });
  fields.oauthCode.value = '';
  await loadConfig();
  show('Token 已保存');
});

document.querySelector('#testPcloud').addEventListener('click', async () => {
  const result = await post('/api/pcloud/test', {});
  show(`连接成功：${result.email || result.userid || 'pCloud'}`);
});

document.querySelector('#exportEncryptionKey').addEventListener('click', exportEncryptionKey);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveConfig();
  await refreshStatus();
  renderTaskCards();
  show('设置已保存');
});

taskEditors.addEventListener('click', async (event) => {
  const action = event.target.dataset.action;
  const editor = event.target.closest('.task-editor');
  if (!action || !editor) {
    return;
  }
  const index = Number(editor.dataset.index);
  if (action === 'remove-task') {
    editor.remove();
    renumberTaskEditors();
    return;
  }
  if (action === 'pick-local') {
    await openFolderPicker({ kind: 'local', index, initialPath: editor.querySelector('[name="localPath"]').value });
  }
  if (action === 'pick-remote') {
    await openFolderPicker({ kind: 'remote', index, initialPath: editor.querySelector('[name="remotePath"]').value });
  }
});

document.querySelector('#folderUp').addEventListener('click', async () => {
  if (folderPicker?.parent !== null) {
    await loadFolder(folderPicker.parent || '');
  }
});

document.querySelector('#folderSelect').addEventListener('click', () => {
  if (!folderPicker) {
    return;
  }
  const editor = taskEditors.querySelector(`.task-editor[data-index="${folderPicker.index}"]`);
  editor.querySelector(`[name="${folderPicker.kind === 'local' ? 'localPath' : 'remotePath'}"]`).value = folderPicker.path;
  folderDialog.close();
});

document.querySelector('#remoteCreate').addEventListener('click', async () => {
  const name = document.querySelector('#remoteFolderName').value.trim();
  if (!name || !folderPicker || folderPicker.kind !== 'remote') {
    return;
  }
  await post('/api/pcloud/folders', { path: joinRemote(folderPicker.path, name) });
  document.querySelector('#remoteFolderName').value = '';
  await loadFolder(folderPicker.path);
});

document.querySelector('#folderEntries').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-path]');
  if (button) {
    await loadFolder(button.dataset.path);
  }
});

decryptControls.up.addEventListener('click', async () => {
  await loadDecryptFolder(decryptBrowser.parent || '/');
});

decryptControls.refresh.addEventListener('click', async () => {
  await loadDecryptFolder(decryptBrowser.path || '/');
});

decryptControls.rows.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-decrypt-folder]');
  if (button) {
    await loadDecryptFolder(button.dataset.decryptFolder || '/');
  }
});

await loadConfig();
await refreshStatus();
showTab('tasks');
setInterval(refreshStatus, 5000);

async function loadConfig() {
  currentConfig = await get('/api/config');
  fields.hostname.value = currentConfig.pcloud.hostname;
  fields.clientId.value = currentConfig.pcloud.clientId || '';
  fields.clientSecret.value = '';
  fields.accessToken.value = currentConfig.pcloud.accessToken ? TOKEN_MASK : '';
  fields.concurrency.value = currentConfig.sync.concurrency;
  fields.renameIfExists.checked = currentConfig.sync.renameIfExists === true;
  fields.checksumMode.value = currentConfig.sync.checksumMode || 'failed';
  fields.checksumSamplePercent.value = currentConfig.sync.checksumSamplePercent ?? 5;
  fields.mtimeVerifyConcurrency.value = currentConfig.sync.mtimeVerifyConcurrency ?? 3;
  fields.encryptionEnabled.checked = currentConfig.sync.encryption?.enabled === true;
  fields.timezone.value = scheduleTimezoneValue(currentConfig.sync.timezone);
  fields.logRetentionDays.value = currentConfig.sync.logRetentionDays;
  fields.logRetentionCount.value = currentConfig.sync.logRetentionCount;
  fields.ignorePatterns.value = currentConfig.sync.ignorePatterns.join('\n');
  renderTaskEditors(currentConfig.tasks || []);
}

async function saveConfig() {
  const pcloud = {
    hostname: fields.hostname.value,
    clientId: fields.clientId.value.trim()
  };
  if (fields.clientSecret.value.trim()) {
    pcloud.clientSecret = fields.clientSecret.value.trim();
  }
  const accessToken = fields.accessToken.value.trim();
  if (accessToken && !['***', TOKEN_MASK].includes(accessToken)) {
    pcloud.accessToken = accessToken;
  }

  const tasks = collectTaskEditors();
  currentConfig = await post('/api/config', {
    pcloud,
    tasks,
    sync: {
      concurrency: Number(fields.concurrency.value),
      renameIfExists: fields.renameIfExists.checked,
      checksumMode: fields.checksumMode.value,
      checksumSamplePercent: Number(fields.checksumSamplePercent.value),
      mtimeVerifyConcurrency: Number(fields.mtimeVerifyConcurrency.value),
      encryption: {
        enabled: fields.encryptionEnabled.checked
      },
      timezone: fields.timezone.value.trim(),
      logRetentionDays: Number(fields.logRetentionDays.value),
      logRetentionCount: Number(fields.logRetentionCount.value),
      ignorePatterns: fields.ignorePatterns.value
    }
  });
  renderTaskEditors(currentConfig.tasks || []);
}

async function exportEncryptionKey() {
  const button = document.querySelector('#exportEncryptionKey');
  button.disabled = true;
  try {
    const response = await fetch('/api/encryption/key');
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = await response.json();
        message = body.error || message;
      } catch {
        // Ignore non-JSON error bodies from interrupted downloads.
      }
      throw new Error(message);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'encryption.key';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    show('加密密钥已导出');
  } catch (error) {
    show(error.message);
  } finally {
    button.disabled = false;
  }
}

async function refreshStatus() {
  currentStatus = await get('/api/status');
  setText('appVersion', currentStatus.version ? `v${currentStatus.version}` : '');
  const activeTaskId = currentStatus.engine?.currentTaskId || '';
  const activeTaskStats = activeTaskId ? taskStatsById().get(activeTaskId) : null;
  const displayedStats = activeTaskStats?.stats || currentStatus.stats;
  setText('metricScope', activeTaskStats ? `当前任务：${activeTaskStats.name}` : '全部任务');
  setText('statTotal', displayedStats.total);
  setText('statSynced', displayedStats.synced);
  setText('statExisting', displayedStats.existing || 0);
  setText('statFailed', displayedStats.failed);
  setText('statPending', displayedStats.pending);
  setText('statUploading', displayedStats.uploading);
  setText('statSpeed', formatBytesPerSecond(currentStatus.engine?.uploadSpeedBytesPerSecond || 0));
  document.querySelector('#stopSync').disabled = !currentStatus.engine?.active && !currentStatus.stats.uploading;
  renderSpeedTest(currentStatus.engine?.speedTest);
  currentEvents = currentStatus.events || [];

  const rows = [...currentStatus.failed, ...currentStatus.pending, ...(currentStatus.uploading || [])].slice(0, 200);
  document.querySelector('#fileRows').innerHTML = rows.map((file) => `
    <tr>
      <td>${escapeHtml(file.status)}</td>
      <td>${escapeHtml(file.key)}</td>
      <td>${escapeHtml(file.error || '')}</td>
    </tr>
  `).join('') || '<tr><td colspan="3">暂无失败、待上传或上传中文件</td></tr>';

  updateTaskOptions(currentLogRows());
  renderEvents();
  renderTaskCards();
}

function showTab(tab) {
  for (const button of document.querySelectorAll('[data-tab]')) {
    button.classList.toggle('active', button.dataset.tab === tab);
  }
  for (const panel of document.querySelectorAll('[data-panel]')) {
    panel.hidden = panel.dataset.panel !== tab;
  }
  const title = { tasks: '同步任务', logs: '同步日志', decrypt: '解密浏览', settings: '设置' }[tab] || '同步任务';
  setText('pageTitle', title);
  if (tab === 'decrypt' && !decryptBrowser.loaded) {
    loadDecryptFolder(decryptBrowser.path || '/').catch((error) => show(error.message));
  }
}

function renderTaskCards() {
  const tasks = currentStatus?.tasks || currentConfig?.tasks || [];
  const statsByTask = taskStatsById();
  const queueByTask = new Map((currentStatus?.engine?.taskQueue || []).map((task) => [task.id, task]));
  taskCards.innerHTML = tasks.map((task) => {
    const counts = taskQueueCounts(task.id);
    const queue = queueByTask.get(task.id);
    const taskStats = statsByTask.get(task.id) || {};
    const stats = taskStats.stats || emptyStats();
    const status = taskStatusText({ queue, stats, counts });
    const scanMode = scanModeText(queue?.scanMode || taskStats.remoteState?.lastScanMode);
    const scanDetails = scanDetailText(queue, taskStats.remoteState);
    const mtimeVerification = taskStats.mtimeVerification || {};
    const verificationJob = (currentStatus?.engine?.mtimeVerifications || []).find((job) => (job.taskId || '') === task.id);
    const verifyRunning = verificationJob?.running === true;
    const verifyLabel = verifyRunning
      ? `校验中 ${formatNumber(verificationJob.checked || 0)}/${formatNumber(verificationJob.totalCandidates || 0)}`
      : '时间校验';
    const verifySummary = mtimeVerificationText(mtimeVerification, verificationJob);
    const mtimeMismatches = Number(queue?.mtimeMismatches ?? taskStats.remoteState?.lastMtimeMismatches ?? 0);
    const showMtimeMenu = mtimeMismatches > 0 || Number(mtimeVerification.mismatched || 0) > 0 || Number(mtimeVerification.failed || 0) > 0;
    return `
      <article class="task-card">
        <div class="task-card-main">
          <div class="task-card-copy">
            <h3>${escapeHtml(task.name)}</h3>
            <p class="${counts.failed > 0 ? 'danger' : 'success'}">${escapeHtml(status)}</p>
            ${scanMode ? `<p class="task-scan-mode">扫描依据：${escapeHtml(scanMode)}</p>` : ''}
            ${scanDetails ? `<p class="task-scan-detail">${escapeHtml(scanDetails)}</p>` : ''}
            ${verifySummary ? `<p class="task-scan-detail">${escapeHtml(verifySummary)}</p>` : ''}
            <div class="task-stat-grid">
              <span>总 ${formatNumber(stats.total)}</span>
              <span>已存在 ${formatNumber(stats.existing || 0)}</span>
              <span>已成功 ${formatNumber(stats.synced)}</span>
              <span>待上传 ${formatNumber(stats.pending)}</span>
              <span>失败 ${formatNumber(stats.failed)}</span>
            </div>
          </div>
          <div class="task-card-actions">
            <button type="button" data-tab="logs">查看日志</button>
            ${showMtimeMenu ? mtimeActionMenu(task, verifyLabel, verifyRunning, mtimeVerification) : ''}
            <button type="button" data-tab="settings">编辑</button>
          </div>
        </div>
      </article>
    `;
  }).join('') || `
    <section class="empty-state">
      <h3>还没有同步任务</h3>
      <p>创建一个任务，选择本地文件夹和 pCloud 目标文件夹后即可开始同步。</p>
      <button type="button" data-tab="settings">去设置</button>
    </section>
  `;
}

async function runScan({ forceRemoteScan = false } = {}) {
  const scanResult = await post('/api/scan', { forceRemoteScan });
  await refreshStatus();
  show(scanResult.skipped
    ? '没有可扫描的同步任务'
    : forceRemoteScan ? '远端重新比对已触发' : '扫描已触发');
}

async function verifyMtimeMismatches(taskId) {
  const result = await post('/api/verify-mtime-mismatches', { taskId });
  await refreshStatus();
  if (result.skipped) {
    show(result.reason || '时间不同校验不可用');
    return;
  }
  show(result.running
    ? '已开始全部校验时间不同文件'
    : `校验 ${result.checked}/${result.totalCandidates}：匹配 ${result.matched}，不一致 ${result.mismatched}，失败 ${result.failed}`);
}

async function handleMtimeMenu(menu) {
  const action = menu.value;
  const taskId = menu.dataset.taskId || '';
  menu.value = '';
  if (!action) {
    return;
  }
  if (action === 'verify') {
    await verifyMtimeMismatches(taskId);
  } else if (action === 'stop') {
    await stopMtimeMismatchVerification(taskId);
  } else if (action === 'mismatched' || action === 'failed') {
    await loadMtimeMismatchDetails(taskId, action);
  }
}

async function stopMtimeMismatchVerification(taskId) {
  const result = await post('/api/verify-mtime-mismatches/stop', { taskId });
  await refreshStatus();
  show(result.running ? '正在暂停校验' : '校验已暂停');
}

function mtimeActionMenu(task, label, running, stats) {
  const mismatched = Number(stats.mismatched || 0);
  const failed = Number(stats.failed || 0);
  return `
    <select class="task-action-select" data-action="mtime-menu" data-task-id="${escapeHtml(task.id)}" aria-label="时间校验">
      <option value="">${escapeHtml(label)}</option>
      ${running ? '<option value="stop">暂停校验</option>' : '<option value="verify">全部校验时间不同</option>'}
      <option value="mismatched" ${mismatched > 0 ? '' : 'disabled'}>查看内容不一致${mismatched > 0 ? ` (${formatNumber(mismatched)})` : ''}</option>
      <option value="failed" ${failed > 0 ? '' : 'disabled'}>查看校验失败${failed > 0 ? ` (${formatNumber(failed)})` : ''}</option>
    </select>
  `;
}

async function loadMtimeMismatchDetails(taskId, status) {
  const body = await get(`/api/mtime-mismatches?taskId=${encodeURIComponent(taskId)}&status=${encodeURIComponent(status)}`);
  const title = status === 'mismatched' ? '内容不一致' : '校验失败';
  setText('mtimeDetailsTitle', title);
  setText('mtimeDetailsSummary', `${body.total} 个文件${body.total > body.files.length ? `，显示前 ${body.files.length} 个` : ''}`);
  document.querySelector('#mtimeDetailsRows').innerHTML = body.files.map((file) => `
    <tr>
      <td>${escapeHtml(file.relativePath || file.key)}</td>
      <td>${formatBytes(file.size || 0)}</td>
      <td>${escapeHtml(mtimeStatusText(file.status))}</td>
      <td>${escapeHtml(formatDateTime(file.verifiedAt))}</td>
      <td>${escapeHtml(file.error || file.remotePath || '')}${status === 'mismatched' ? mismatchResolutionActions(body.taskId, file) : ''}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">暂无文件</td></tr>';
  mtimeDetailsDialog.showModal();
}

async function resolveMtimeMismatch(button) {
  const action = button.dataset.mtimeResolution;
  const key = button.dataset.key;
  const taskId = button.dataset.taskId || '';
  button.disabled = true;
  try {
    await post('/api/mtime-mismatches/resolve', { key, action });
    await refreshStatus();
    await loadMtimeMismatchDetails(taskId, 'mismatched');
    show(action === 'upload_local' ? '已上传本地文件覆盖远端' : '已下载远端文件覆盖本地');
  } catch (error) {
    show(error.message);
  } finally {
    button.disabled = false;
  }
}

function mismatchResolutionActions(taskId, file) {
  const key = escapeHtml(file.key);
  const sourceId = escapeHtml(taskId || file.sourceId || '');
  return `
    <div class="resolution-actions">
      <button type="button" data-mtime-resolution="upload_local" data-key="${key}" data-task-id="${sourceId}">上传本地</button>
      <button type="button" data-mtime-resolution="download_remote" data-key="${key}" data-task-id="${sourceId}">下载远端</button>
    </div>
  `;
}

function scanModeText(scanMode) {
  return {
    remote_full: '远端全量比对',
    cache: '本地缓存',
    remote_diff: '远端增量'
  }[scanMode] || '';
}

function scanDetailText(queue, remoteState) {
  const discovered = queue?.discovered ?? remoteState?.lastDiscovered;
  const remoteFiles = queue?.remoteFiles ?? remoteState?.lastRemoteFiles;
  const localMs = queue?.localScanMs ?? remoteState?.lastLocalScanMs;
  const remoteMs = queue?.remoteScanMs ?? remoteState?.lastRemoteScanMs;
  const diffMs = queue?.diffScanMs ?? remoteState?.lastDiffScanMs;
  const mtimeMismatches = queue?.mtimeMismatches ?? remoteState?.lastMtimeMismatches;
  const parts = [];
  if (Number.isFinite(Number(discovered))) {
    parts.push(`本地 ${formatNumber(discovered)}`);
  }
  if (Number.isFinite(Number(remoteFiles))) {
    parts.push(`远端 ${formatNumber(remoteFiles)}`);
  }
  if (Number.isFinite(Number(mtimeMismatches)) && Number(mtimeMismatches) > 0) {
    parts.push(`时间不同 ${formatNumber(mtimeMismatches)}`);
  }
  if (Number.isFinite(Number(localMs))) {
    parts.push(`本地扫描 ${formatDuration(localMs)}`);
  }
  if (Number.isFinite(Number(remoteMs)) && Number(remoteMs) > 0) {
    parts.push(`远端列举 ${formatDuration(remoteMs)}`);
  }
  if (Number.isFinite(Number(diffMs)) && Number(diffMs) > 0) {
    parts.push(`远端增量 ${formatDuration(diffMs)}`);
  }
  return parts.join(' · ');
}

function mtimeVerificationText(stats = {}, job = null) {
  const parts = [];
  if (job?.running) {
    parts.push(`时间校验中 ${formatNumber(job.checked || 0)}/${formatNumber(job.totalCandidates || 0)}`);
  }
  if (Number(stats.matched || 0) > 0) {
    parts.push(`时间不同已校验 ${formatNumber(stats.matched)}`);
  }
  if (Number(stats.mismatched || 0) > 0) {
    parts.push(`内容不一致 ${formatNumber(stats.mismatched)}`);
  }
  if (Number(stats.failed || 0) > 0) {
    parts.push(`校验失败 ${formatNumber(stats.failed)}`);
  }
  return parts.join(' · ');
}

function taskQueueCounts(taskId) {
  const files = [
    ...(currentStatus?.failed || []),
    ...(currentStatus?.pending || []),
    ...(currentStatus?.uploading || [])
  ].filter((file) => file.sourceId === taskId || String(file.key || '').startsWith(`${taskId}/`));
  return {
    failed: files.filter((file) => file.status === 'failed').length,
    pending: files.filter((file) => file.status === 'pending').length,
    uploading: files.filter((file) => file.status === 'uploading').length
  };
}

function renderTaskEditors(tasks) {
  taskEditors.innerHTML = '';
  for (const task of tasks) {
    addTaskEditor(task);
  }
}

function addTaskEditor(task = {}) {
  const index = taskEditors.children.length;
  const schedule = scheduleFromTask(task);
  const weekdays = new Set(schedule.weekdays || []);
  const editor = document.createElement('section');
  editor.className = 'task-editor';
  editor.dataset.index = String(index);
  editor.innerHTML = `
    <div class="task-editor-head">
      <label class="inline-check">
        <input name="enabled" type="checkbox" ${task.enabled === false ? '' : 'checked'}>
        启用
      </label>
      <button data-action="remove-task" type="button">删除</button>
    </div>
    <label>
      任务名称
      <input name="name" value="${escapeHtml(task.name || '')}" placeholder="例如 财务备份">
    </label>
    <label>
      本地文件夹
      <div class="input-action">
        <input name="localPath" value="${escapeHtml(task.localPath || '')}" placeholder="/vol1/1000/work">
        <button data-action="pick-local" type="button">选择</button>
      </div>
    </label>
    <label>
      pCloud 文件夹
      <div class="input-action">
        <input name="remotePath" value="${escapeHtml(task.remotePath || '')}" placeholder="/Sync/Psync">
        <button data-action="pick-remote" type="button">选择</button>
      </div>
    </label>
    <div class="schedule-grid">
      <label>
        定时方式
        <select name="scheduleType">
          <option value="interval" ${schedule.type === 'interval' ? 'selected' : ''}>按间隔</option>
          <option value="daily" ${schedule.type === 'daily' ? 'selected' : ''}>每天</option>
          <option value="weekly" ${schedule.type === 'weekly' ? 'selected' : ''}>每周</option>
          <option value="manual" ${schedule.type === 'manual' ? 'selected' : ''}>手动</option>
        </select>
      </label>
      <label data-schedule-field="interval">
        间隔秒
        <input name="scheduleIntervalSeconds" type="number" min="30" step="30" value="${escapeHtml(String(schedule.intervalSeconds || currentConfig?.sync?.intervalSeconds || 300))}">
      </label>
      <label data-schedule-field="time">
        时间
        <input name="scheduleTime" type="time" value="${escapeHtml(schedule.time || '00:00')}">
      </label>
      <label class="weekday-row" data-schedule-field="weekly">
        每周
        <span class="weekday-options">
          ${weekdayInputs(weekdays)}
        </span>
      </label>
    </div>
    <input name="id" type="hidden" value="${escapeHtml(task.id || '')}">
  `;
  taskEditors.append(editor);
  editor.querySelector('[name="scheduleType"]').addEventListener('change', () => updateScheduleVisibility(editor));
  updateScheduleVisibility(editor);
}

function collectTaskEditors() {
  return [...taskEditors.querySelectorAll('.task-editor')]
    .map((editor) => ({
      id: editor.querySelector('[name="id"]').value,
      name: editor.querySelector('[name="name"]').value.trim(),
      localPath: editor.querySelector('[name="localPath"]').value.trim(),
      remotePath: editor.querySelector('[name="remotePath"]').value.trim(),
      enabled: editor.querySelector('[name="enabled"]').checked,
      mode: 'upload',
      schedule: collectSchedule(editor)
    }))
    .filter((task) => task.name || task.localPath || task.remotePath);
}

function taskStatsById() {
  return new Map((currentStatus?.taskStats || []).map((task) => [task.id, task]));
}

function emptyStats() {
  return {
    total: 0,
    synced: 0,
    existing: 0,
    failed: 0,
    pending: 0,
    uploading: 0
  };
}

function scheduleFromTask(task) {
  const schedule = task.schedule || {};
  if (['manual', 'daily', 'weekly', 'interval'].includes(schedule.type)) {
    return {
      type: schedule.type,
      intervalSeconds: Number(schedule.intervalSeconds || currentConfig?.sync?.intervalSeconds || 300),
      time: schedule.time || '00:00',
      weekdays: Array.isArray(schedule.weekdays) ? schedule.weekdays : [1]
    };
  }
  return {
    type: 'interval',
    intervalSeconds: Number(currentConfig?.sync?.intervalSeconds || 300),
    time: '00:00',
    weekdays: [1]
  };
}

function collectSchedule(editor) {
  const type = editor.querySelector('[name="scheduleType"]').value;
  if (type === 'manual') {
    return { type: 'manual' };
  }
  if (type === 'daily') {
    return { type: 'daily', time: editor.querySelector('[name="scheduleTime"]').value || '00:00' };
  }
  if (type === 'weekly') {
    return {
      type: 'weekly',
      time: editor.querySelector('[name="scheduleTime"]').value || '00:00',
      weekdays: [...editor.querySelectorAll('[name="scheduleWeekdays"]:checked')].map((input) => Number(input.value))
    };
  }
  return {
    type: 'interval',
    intervalSeconds: Number(editor.querySelector('[name="scheduleIntervalSeconds"]').value || currentConfig?.sync?.intervalSeconds || 300)
  };
}

function updateScheduleVisibility(editor) {
  const type = editor.querySelector('[name="scheduleType"]').value;
  for (const field of editor.querySelectorAll('[data-schedule-field]')) {
    const fieldName = field.dataset.scheduleField;
    field.hidden = fieldName === 'interval' ? type !== 'interval'
      : fieldName === 'time' ? !['daily', 'weekly'].includes(type)
        : type !== 'weekly';
  }
}

function weekdayInputs(selected) {
  const labels = [
    ['1', '一'],
    ['2', '二'],
    ['3', '三'],
    ['4', '四'],
    ['5', '五'],
    ['6', '六'],
    ['0', '日']
  ];
  return labels.map(([value, label]) => `
    <label>
      <input name="scheduleWeekdays" type="checkbox" value="${value}" ${selected.has(Number(value)) ? 'checked' : ''}>
      ${label}
    </label>
  `).join('');
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

function mtimeStatusText(status) {
  return {
    matched: '已校验',
    mismatched: '内容不一致',
    failed: '校验失败'
  }[status] || status || '';
}

function renumberTaskEditors() {
  [...taskEditors.querySelectorAll('.task-editor')].forEach((editor, index) => {
    editor.dataset.index = String(index);
  });
}

async function openFolderPicker({ kind, index, initialPath }) {
  folderPicker = { kind, index, path: initialPath || '', parent: null };
  setText('folderDialogTitle', kind === 'local' ? '选择本地文件夹' : '选择 pCloud 文件夹');
  document.querySelector('#remoteCreateRow').hidden = kind !== 'remote';
  folderDialog.showModal();
  await loadFolder(initialPath || '');
}

async function loadFolder(targetPath) {
  const endpoint = folderPicker.kind === 'local'
    ? `/api/local-folders?path=${encodeURIComponent(targetPath || '')}`
    : `/api/pcloud/folders?path=${encodeURIComponent(targetPath || '/')}`;
  const result = await get(endpoint);
  folderPicker.path = result.path;
  folderPicker.parent = result.parent;
  setText('folderPath', result.path);
  document.querySelector('#folderEntries').innerHTML = result.entries.map((entry) => `
    <li><button type="button" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button></li>
  `).join('') || '<li class="empty">没有子文件夹</li>';
}

async function loadDecryptFolder(remotePath = '/') {
  decryptBrowser.loaded = true;
  decryptControls.up.disabled = true;
  decryptControls.rows.innerHTML = '<tr><td colspan="4" class="empty">加载中</td></tr>';
  try {
    const result = await get(`/api/encryption/browse?path=${encodeURIComponent(remotePath || '/')}`);
    decryptBrowser.path = result.path || '/';
    decryptBrowser.parent = result.parent || '/';
    decryptBrowser.entries = result.entries || [];
    renderDecryptBrowser();
  } catch (error) {
    decryptControls.rows.innerHTML = `<tr><td colspan="4" class="danger">${escapeHtml(error.message)}</td></tr>`;
    show(error.message);
  }
}

function renderDecryptBrowser() {
  decryptControls.path.textContent = decryptBrowser.path || '/';
  decryptControls.up.disabled = !decryptBrowser.parent || decryptBrowser.path === '/';
  decryptControls.rows.innerHTML = decryptBrowser.entries.map((entry) => {
    if (entry.type === 'folder') {
      return `
        <tr>
          <td>${escapeHtml(entry.name)}</td>
          <td>文件夹</td>
          <td>--</td>
          <td><button type="button" data-decrypt-folder="${escapeHtml(entry.path)}">打开</button></td>
        </tr>
      `;
    }
    const decryptedName = entry.decryptedName || stripEncryptedSuffix(entry.name);
    const downloadUrl = `/api/encryption/download?path=${encodeURIComponent(entry.path)}`;
    return `
      <tr>
        <td>${escapeHtml(decryptedName)}</td>
        <td>加密文件</td>
        <td>${escapeHtml(formatBytes(entry.size || 0))}</td>
        <td><a class="button-link" href="${downloadUrl}" download="${escapeHtml(decryptedName)}">下载</a></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="4" class="empty">暂无加密文件</td></tr>';
}

function stripEncryptedSuffix(name) {
  const text = String(name || '');
  return text.endsWith('.pcenc') ? text.slice(0, -'.pcenc'.length) : text;
}

function updateTaskOptions(rows) {
  const selected = eventFilters.task.value;
  const tasks = [...new Set(rows.map((row) => row.task))].filter(Boolean).sort();
  eventFilters.task.innerHTML = [
    '<option value="">全部任务</option>',
    ...tasks.map((task) => `<option value="${escapeHtml(task)}">${escapeHtml(task)}</option>`)
  ].join('');
  if (tasks.includes(selected)) {
    eventFilters.task.value = selected;
  }
}

function currentLogRows() {
  const activeUploads = new Map((currentStatus?.engine?.activeUploads || []).map((upload) => [upload.key, upload]));
  const uploadingRows = (currentStatus?.uploading || []).map((file) => uploadToLogRow(file, activeUploads.get(file.key)));
  const eventRows = fileLogEvents(currentEvents).map(eventToLogRow);
  return [...uploadingRows, ...eventRows];
}

function renderEvents() {
  const taskFilter = eventFilters.task.value;
  const statusFilter = eventFilters.status.value;
  const search = eventFilters.search.value.trim().toLowerCase();
  const rows = currentLogRows()
    .filter((row) => !taskFilter || row.task === taskFilter)
    .filter((row) => !statusFilter || row.status === statusFilter)
    .filter((row) => !search || row.fileName.toLowerCase().includes(search))
    .slice(0, 200);

  document.querySelector('#events').innerHTML = rows.map((row) => `
    <tr>
      <td title="${escapeHtml(row.fileName)}">${escapeHtml(row.fileName)}</td>
      <td>${escapeHtml(row.sizeText)}</td>
      <td>${escapeHtml(row.task)}</td>
      <td>${escapeHtml(row.time)}</td>
      <td title="${escapeHtml(row.detail)}"><span class="log-status ${escapeHtml(row.status)}">${escapeHtml(row.statusText)}</span></td>
      <td>${escapeHtml(row.progressText)}</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="empty">暂无文件同步日志</td></tr>';
}

function renderSpeedTest(speedTest) {
  const button = document.querySelector('#startSpeedTest');
  const result = document.querySelector('#speedTestResult');
  if (!result) {
    return;
  }
  button.disabled = speedTest?.running === true;
  if (!speedTest) {
    result.innerHTML = `
      <span>状态：未测试</span>
      <span>上传速度：--</span>
      <span>下载速度：--</span>
      <span>校验：--</span>
    `;
    return;
  }
  result.innerHTML = `
    <span>状态：${escapeHtml(speedTestPhaseText(speedTest.phase, speedTest.running))}</span>
    <span>大小：${escapeHtml(formatBytes(speedTest.sizeBytes || 0))}</span>
    <span>上传速度：${escapeHtml(speedTest.upload ? formatBytesPerSecond(speedTest.upload.bytesPerSecond) : '--')}</span>
    <span>下载速度：${escapeHtml(speedTest.download ? formatBytesPerSecond(speedTest.download.bytesPerSecond) : '--')}</span>
    ${speedTest.uploadProgress ? `<span>上传进度：${escapeHtml(formatProgress(speedTest.uploadProgress))}</span>` : ''}
    ${speedTest.downloadProgress ? `<span>下载进度：${escapeHtml(formatProgress(speedTest.downloadProgress))}</span>` : ''}
    <span>校验：${speedTest.checksumMatched ? '通过' : speedTest.phase === 'completed' ? '失败' : '--'}</span>
    ${speedTest.error ? `<span class="danger">错误：${escapeHtml(speedTest.error)}</span>` : ''}
  `;
}

function speedTestPhaseText(phase, running) {
  if (running) {
    return {
      starting: '准备中',
      generating: '生成测试文件',
      uploading: '上传测速',
      downloading: '下载测速'
    }[phase] || '测速中';
  }
  return {
    completed: '完成',
    failed: '失败'
  }[phase] || '未测试';
}

function formatProgress(progress) {
  return `${formatBytes(progress.bytes || 0)} / ${formatBytes(progress.totalBytes || 0)} · ${progress.percent || 0}% · ${formatBytesPerSecond(progress.bytesPerSecond || 0)}`;
}

function formatBytesPerSecond(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB/s`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(value)} B/s`;
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (value < 1000) {
    return `${Math.max(0, Math.round(value))}ms`;
  }
  return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}s`;
}

async function get(url) {
  const response = await fetch(url);
  return parseResponse(response);
}

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

async function del(url) {
  const response = await fetch(url, { method: 'DELETE' });
  return parseResponse(response);
}

async function parseResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || response.statusText);
  }
  return body;
}

function setText(id, value) {
  document.querySelector(`#${id}`).textContent = String(value);
}

function show(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2400);
}

function joinRemote(...parts) {
  const joined = parts.join('/').replaceAll('\\', '/').split('/').filter(Boolean).join('/');
  return `/${joined}`;
}

function scheduleTimezoneValue(saved) {
  const value = String(saved || '').trim();
  if (value && value !== 'UTC') {
    return value;
  }
  return browserTimezone();
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
