import { eventToLogRow, fileLogEvents } from './logRows.js';

const TOKEN_MASK = '******';
const form = document.querySelector('#settingsForm');
const toast = document.querySelector('#toast');
const taskEditors = document.querySelector('#taskEditors');
const taskCards = document.querySelector('#taskCards');
const folderDialog = document.querySelector('#folderDialog');
let currentConfig = null;
let currentStatus = null;
let currentEvents = [];
let folderPicker = null;

const fields = {
  hostname: form.elements.hostname,
  clientId: form.elements.clientId,
  clientSecret: form.elements.clientSecret,
  oauthCode: form.elements.oauthCode,
  accessToken: form.elements.accessToken,
  remoteRoot: form.elements.remoteRoot,
  intervalSeconds: form.elements.intervalSeconds,
  concurrency: form.elements.concurrency,
  logRetentionDays: form.elements.logRetentionDays,
  logRetentionCount: form.elements.logRetentionCount,
  ignorePatterns: form.elements.ignorePatterns
};

const eventFilters = {
  task: document.querySelector('#eventTaskFilter'),
  status: document.querySelector('#eventStatusFilter'),
  search: document.querySelector('#eventSearch')
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

document.querySelector('#createTask').addEventListener('click', () => {
  addTaskEditor();
  showTab('settings');
});

document.querySelector('#addTask').addEventListener('click', addTaskEditor);

document.querySelector('#scanNow').addEventListener('click', async () => {
  await post('/api/scan', {});
  await refreshStatus();
  show('扫描已触发');
});

document.querySelector('#retryFailed').addEventListener('click', async () => {
  const result = await post('/api/retry-failed', {});
  await refreshStatus();
  show(`${result.queued} 个已入队，${result.uploaded || 0} 个已上传，${result.failed || 0} 个失败`);
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
    await openFolderPicker({ kind: 'remote', index, initialPath: editor.querySelector('[name="remotePath"]').value || fields.remoteRoot.value });
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
  fields.remoteRoot.value = currentConfig.pcloud.remoteRoot;
  fields.intervalSeconds.value = currentConfig.sync.intervalSeconds;
  fields.concurrency.value = currentConfig.sync.concurrency;
  fields.logRetentionDays.value = currentConfig.sync.logRetentionDays;
  fields.logRetentionCount.value = currentConfig.sync.logRetentionCount;
  fields.ignorePatterns.value = currentConfig.sync.ignorePatterns.join('\n');
  renderTaskEditors(currentConfig.tasks || []);
}

async function saveConfig() {
  const pcloud = {
    hostname: fields.hostname.value,
    clientId: fields.clientId.value.trim(),
    remoteRoot: fields.remoteRoot.value.trim()
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
      intervalSeconds: Number(fields.intervalSeconds.value),
      concurrency: Number(fields.concurrency.value),
      logRetentionDays: Number(fields.logRetentionDays.value),
      logRetentionCount: Number(fields.logRetentionCount.value),
      ignorePatterns: fields.ignorePatterns.value
    }
  });
  renderTaskEditors(currentConfig.tasks || []);
}

async function refreshStatus() {
  currentStatus = await get('/api/status');
  setText('appVersion', currentStatus.version ? `v${currentStatus.version}` : '');
  setText('statTotal', currentStatus.stats.total);
  setText('statSynced', currentStatus.stats.synced);
  setText('statFailed', currentStatus.stats.failed);
  setText('statPending', currentStatus.stats.pending);
  setText('statUploading', currentStatus.stats.uploading);
  setText('statSpeed', formatBytesPerSecond(currentStatus.engine?.uploadSpeedBytesPerSecond || 0));
  currentEvents = currentStatus.events || [];

  const rows = [...currentStatus.failed, ...currentStatus.pending, ...(currentStatus.uploading || [])].slice(0, 200);
  document.querySelector('#fileRows').innerHTML = rows.map((file) => `
    <tr>
      <td>${escapeHtml(file.status)}</td>
      <td>${escapeHtml(file.key)}</td>
      <td>${escapeHtml(file.error || '')}</td>
    </tr>
  `).join('') || '<tr><td colspan="3">暂无失败、待上传或上传中文件</td></tr>';

  updateTaskOptions(fileLogEvents(currentEvents));
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
  const title = { tasks: '同步任务', logs: '同步日志', settings: '设置' }[tab] || '同步任务';
  setText('pageTitle', title);
}

function renderTaskCards() {
  const tasks = currentStatus?.tasks || currentConfig?.tasks || [];
  taskCards.innerHTML = tasks.map((task) => {
    const counts = taskQueueCounts(task.id);
    const status = counts.failed > 0 ? '同步异常' : counts.pending + counts.uploading > 0 ? '等待同步' : '同步完成';
    return `
      <article class="task-card">
        <div class="task-card-main">
          <div class="task-card-copy">
            <h3>${escapeHtml(task.name)}</h3>
            <p class="${counts.failed > 0 ? 'danger' : 'success'}">${escapeHtml(status)}</p>
          </div>
          <div class="task-card-actions">
            <button type="button" data-tab="logs">查看日志</button>
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
        <input name="remotePath" value="${escapeHtml(task.remotePath || '')}" placeholder="/NAS-Backup/work">
        <button data-action="pick-remote" type="button">选择</button>
      </div>
    </label>
    <input name="id" type="hidden" value="${escapeHtml(task.id || '')}">
  `;
  taskEditors.append(editor);
}

function collectTaskEditors() {
  return [...taskEditors.querySelectorAll('.task-editor')]
    .map((editor) => ({
      id: editor.querySelector('[name="id"]').value,
      name: editor.querySelector('[name="name"]').value.trim(),
      localPath: editor.querySelector('[name="localPath"]').value.trim(),
      remotePath: editor.querySelector('[name="remotePath"]').value.trim(),
      enabled: editor.querySelector('[name="enabled"]').checked,
      mode: 'upload'
    }))
    .filter((task) => task.name || task.localPath || task.remotePath);
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
    : `/api/pcloud/folders?path=${encodeURIComponent(targetPath || fields.remoteRoot.value || '/')}`;
  const result = await get(endpoint);
  folderPicker.path = result.path;
  folderPicker.parent = result.parent;
  setText('folderPath', result.path);
  document.querySelector('#folderEntries').innerHTML = result.entries.map((entry) => `
    <li><button type="button" data-path="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</button></li>
  `).join('') || '<li class="empty">没有子文件夹</li>';
}

function updateTaskOptions(events) {
  const selected = eventFilters.task.value;
  const tasks = [...new Set(events.map((event) => eventToLogRow(event).task))].filter(Boolean).sort();
  eventFilters.task.innerHTML = [
    '<option value="">全部任务</option>',
    ...tasks.map((task) => `<option value="${escapeHtml(task)}">${escapeHtml(task)}</option>`)
  ].join('');
  if (tasks.includes(selected)) {
    eventFilters.task.value = selected;
  }
}

function renderEvents() {
  const taskFilter = eventFilters.task.value;
  const statusFilter = eventFilters.status.value;
  const search = eventFilters.search.value.trim().toLowerCase();
  const rows = fileLogEvents(currentEvents)
    .map(eventToLogRow)
    .filter((row) => !taskFilter || row.task === taskFilter)
    .filter((row) => !statusFilter || row.status === statusFilter)
    .filter((row) => !search || row.fileName.toLowerCase().includes(search))
    .slice(0, 200);

  document.querySelector('#events').innerHTML = rows.map((row) => `
    <tr>
      <td title="${escapeHtml(row.fileName)}">${escapeHtml(row.fileName)}</td>
      <td>${escapeHtml(row.task)}</td>
      <td>${escapeHtml(row.time)}</td>
      <td><span class="log-status ${escapeHtml(row.status)}">${escapeHtml(row.statusText)}</span></td>
      <td title="${escapeHtml(row.detail)}">
        <span>${escapeHtml(row.eventText)}</span>
        ${row.detail ? `<small>${escapeHtml(row.detail)}</small>` : ''}
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">暂无文件同步日志</td></tr>';
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
