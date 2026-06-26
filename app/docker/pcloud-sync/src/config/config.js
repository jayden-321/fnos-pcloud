const DEFAULT_CONFIG = {
  port: 8080,
  pcloud: {
    hostname: 'api.pcloud.com',
    clientId: '',
    clientSecret: '',
    accessToken: '',
    remoteRoot: '/'
  },
  sync: {
    intervalSeconds: 300,
    concurrency: 2,
    ignorePatterns: ['.DS_Store', 'Thumbs.db', '*.tmp', '*.part', '~$*'],
    logRetentionDays: 30,
    logRetentionCount: 300,
    renameIfExists: false,
    checksumMode: 'failed',
    checksumSamplePercent: 5
  },
  tasks: [],
  sources: []
};

const OFFICIAL_PCLOUD_HOSTS = new Set([
  'api.pcloud.com',
  'eapi.pcloud.com'
]);

export function normalizeConfig(input = {}) {
  const raw = structuredClone(input ?? {});
  const pcloud = normalizePCloud(raw.pcloud ?? {});
  const sync = normalizeSync(raw.sync ?? {});
  const legacySources = normalizeSources(raw.sources ?? []);
  const hasExplicitTasks = Object.hasOwn(raw, 'tasks');
  const tasks = normalizeTasks(hasExplicitTasks ? raw.tasks : undefined, hasExplicitTasks ? [] : legacySources, pcloud.remoteRoot);
  const sources = hasExplicitTasks
    ? tasksToSources(tasks, pcloud.remoteRoot)
    : legacySources.length > 0 ? legacySources : tasksToSources(tasks, pcloud.remoteRoot);
  const port = clampInteger(raw.port, DEFAULT_CONFIG.port, 1, 65535);

  return { port, pcloud, sync, tasks, sources };
}

export function redactConfig(config) {
  const redacted = structuredClone(config);
  for (const key of ['clientSecret', 'accessToken']) {
    if (redacted.pcloud?.[key]) {
      redacted.pcloud[key] = '***';
    }
  }
  return redacted;
}

export function allowedPCloudHosts() {
  return [...OFFICIAL_PCLOUD_HOSTS];
}

function normalizePCloud(input) {
  const hostname = String(input.hostname || DEFAULT_CONFIG.pcloud.hostname).trim();
  if (!isOfficialPCloudHost(hostname) && !isLocalTestUrl(hostname)) {
    throw new Error(`Unsupported pCloud API hostname: ${hostname}`);
  }

  return {
    hostname,
    clientId: String(input.clientId || '').trim(),
    clientSecret: String(input.clientSecret || '').trim(),
    accessToken: String(input.accessToken || '').trim(),
    remoteRoot: cleanRemoteRoot(input.remoteRoot || DEFAULT_CONFIG.pcloud.remoteRoot)
  };
}

function isOfficialPCloudHost(hostname) {
  return OFFICIAL_PCLOUD_HOSTS.has(hostname) || /^(e?api)[a-z0-9-]*\.pcloud\.com$/.test(hostname);
}

function normalizeSync(input) {
  return {
    intervalSeconds: clampInteger(input.intervalSeconds, DEFAULT_CONFIG.sync.intervalSeconds, 30, 86400),
    concurrency: clampInteger(input.concurrency, DEFAULT_CONFIG.sync.concurrency, 1, 8),
    logRetentionDays: clampInteger(input.logRetentionDays, DEFAULT_CONFIG.sync.logRetentionDays, 0, 3650),
    logRetentionCount: clampInteger(input.logRetentionCount, DEFAULT_CONFIG.sync.logRetentionCount, 0, 10000),
    renameIfExists: input.renameIfExists === true,
    checksumMode: normalizeChecksumMode(input.checksumMode),
    checksumSamplePercent: clampInteger(input.checksumSamplePercent, DEFAULT_CONFIG.sync.checksumSamplePercent, 0, 100),
    ignorePatterns: normalizeIgnorePatterns(input.ignorePatterns ?? DEFAULT_CONFIG.sync.ignorePatterns)
  };
}

function normalizeChecksumMode(value) {
  const mode = String(value || DEFAULT_CONFIG.sync.checksumMode).trim();
  return ['off', 'failed', 'sample', 'all'].includes(mode) ? mode : DEFAULT_CONFIG.sync.checksumMode;
}

function normalizeSources(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set();
  const sources = [];
  for (const item of input) {
    const sourcePath = String(item?.path || '').trim();
    if (!sourcePath) {
      continue;
    }

    const sourceName = nameFromPath(sourcePath);
    const legacyId = legacySlugFromPath(sourcePath);
    const id = normalizeSourceName(item.id, legacyId, sourceName);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    sources.push({
      id,
      path: sourcePath,
      enabled: item.enabled !== false,
      remoteName: cleanRemoteName(normalizeRemoteSourceName(item.remoteName, legacyId, sourceName, id))
    });
  }
  return sources;
}

function normalizeTasks(input, legacySources, remoteRoot) {
  const items = Array.isArray(input) && input.length > 0
    ? input
    : legacySources.map((source) => ({
        id: source.id,
        name: source.id,
        localPath: source.path,
        remotePath: joinRemote(remoteRoot, source.remoteName),
        enabled: source.enabled,
        mode: 'upload'
      }));

  const seen = new Set();
  const tasks = [];
  for (const item of items) {
    const localPath = String(item?.localPath || item?.path || '').trim();
    if (!localPath) {
      continue;
    }
    const fallbackName = nameFromPath(localPath);
    const name = cleanTaskName(item?.name || item?.id || fallbackName);
    const legacyId = legacySlugFromPath(localPath);
    const id = cleanTaskName(normalizeSourceName(item?.id, legacyId, name));
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    tasks.push({
      id,
      name,
      enabled: item?.enabled !== false,
      localPath,
      remotePath: cleanRemoteRoot(item?.remotePath || joinRemote(item?.remoteName || fallbackName)),
      mode: 'upload',
      ...schedulePatch(item?.schedule)
    });
  }
  return tasks;
}

function tasksToSources(tasks, remoteRoot) {
  return tasks.map((task) => ({
    id: task.id,
    path: task.localPath,
    enabled: task.enabled,
    remoteName: remoteNameFromPath(task.remotePath, remoteRoot)
  }));
}

function normalizeIgnorePatterns(input) {
  const values = Array.isArray(input)
    ? input
    : String(input || '').replaceAll('\\n', '\n').split(/\r?\n|,/);
  return values
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function cleanRemoteRoot(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/');
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const parts = withSlash.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Remote root cannot contain relative path segments');
  }
  return `/${parts.join('/')}` || '/';
}

function cleanRemoteName(value) {
  const cleaned = String(value || '').trim().replaceAll('\\', '/').split('/').filter(Boolean).join('-');
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('Remote name cannot be empty');
  }
  return cleaned;
}

function cleanTaskName(value) {
  return cleanRemoteName(value);
}

function schedulePatch(input) {
  const schedule = normalizeTaskSchedule(input);
  return schedule ? { schedule } : {};
}

function normalizeTaskSchedule(input) {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const type = String(input.type || '').trim();
  if (type === 'manual') {
    return { type: 'manual' };
  }
  if (type === 'daily') {
    return { type: 'daily', time: cleanScheduleTime(input.time) };
  }
  if (type === 'weekly') {
    return {
      type: 'weekly',
      time: cleanScheduleTime(input.time),
      weekdays: normalizeWeekdays(input.weekdays)
    };
  }
  if (type === 'interval') {
    return {
      type: 'interval',
      intervalSeconds: clampInteger(input.intervalSeconds, DEFAULT_CONFIG.sync.intervalSeconds, 30, 86400)
    };
  }
  return null;
}

function cleanScheduleTime(value) {
  const raw = String(value || '').trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  return match ? raw : '00:00';
}

function normalizeWeekdays(input) {
  const values = Array.isArray(input) ? input : [];
  const seen = new Set();
  for (const value of values) {
    const number = Number.parseInt(value, 10);
    if (Number.isInteger(number) && number >= 0 && number <= 6) {
      seen.add(number);
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function normalizeSourceName(value, legacyValue, fallback) {
  const raw = String(value || '').trim();
  if (shouldMigrateLegacyName(raw, legacyValue, fallback)) {
    return fallback;
  }
  return raw || fallback;
}

function normalizeRemoteSourceName(value, legacyValue, sourceName, fallback) {
  const raw = String(value || '').trim();
  if (shouldMigrateLegacyName(raw, legacyValue, sourceName)) {
    return sourceName;
  }
  return raw || fallback;
}

function shouldMigrateLegacyName(value, legacyValue, fallback) {
  return Boolean(value)
    && value === legacyValue
    && value !== fallback
    && hasNonAscii(fallback);
}

function nameFromPath(sourcePath) {
  const parts = sourcePath.replaceAll('\\', '/').split('/').filter(Boolean);
  const basename = parts.at(-1) || 'source';
  return cleanRemoteName(basename);
}

function legacySlugFromPath(sourcePath) {
  const parts = sourcePath.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.at(-1)?.replace(/[^a-zA-Z0-9._-]/g, '-') || 'source';
}

function hasNonAscii(value) {
  return /[^\x00-\x7F]/.test(value);
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
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

function remoteNameFromPath(remotePath, remoteRoot) {
  const cleanPath = cleanRemoteRoot(remotePath);
  const cleanRoot = cleanRemoteRoot(remoteRoot);
  const prefix = cleanRoot === '/' ? '/' : `${cleanRoot}/`;
  if (cleanPath.startsWith(prefix)) {
    const relative = cleanPath.slice(prefix.length).split('/').filter(Boolean).join('-');
    return cleanRemoteName(relative || nameFromPath(cleanPath));
  }
  return cleanRemoteName(cleanPath.split('/').filter(Boolean).join('-') || 'remote');
}

function isLocalTestUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}
