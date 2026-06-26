import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATE_FILE = 'state.json';
const EVENT_LIMIT = 300;

export class JsonStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, STATE_FILE);
    this.state = {
      config: null,
      files: {},
      events: []
    };
    this.saveQueue = Promise.resolve();
    this.saveCounter = 0;
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.statePath, 'utf8'));
      this.state.files ??= {};
      this.state.events ??= [];
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await this.#save();
    }
  }

  async loadConfig() {
    return structuredClone(this.state.config);
  }

  async saveConfig(config) {
    this.state.config = structuredClone(config);
    await this.#save();
  }

  async upsertFile(file) {
    if (!file?.key) {
      throw new Error('File record requires key');
    }
    const previous = this.state.files[file.key] ?? {};
    this.state.files[file.key] = {
      ...previous,
      ...structuredClone(file),
      updatedAt: new Date().toISOString()
    };
    await this.#save();
    return structuredClone(this.state.files[file.key]);
  }

  async getFile(key) {
    return structuredClone(this.state.files[key] ?? null);
  }

  async listFiles(filter = {}) {
    let files = Object.values(this.state.files);
    if (filter.status) {
      files = files.filter((file) => file.status === filter.status);
    }
    return structuredClone(files.sort((a, b) => String(a.key).localeCompare(String(b.key))));
  }

  async fileMap() {
    const map = new Map();
    for (const file of Object.values(this.state.files)) {
      map.set(file.key, structuredClone(file));
    }
    return map;
  }

  async setStatus(key, status, patch = {}) {
    const previous = this.state.files[key];
    if (!previous) {
      throw new Error(`Unknown file record: ${key}`);
    }
    this.state.files[key] = {
      ...previous,
      ...structuredClone(patch),
      status,
      updatedAt: new Date().toISOString()
    };
    await this.#save();
    return structuredClone(this.state.files[key]);
  }

  async resetFailed() {
    let count = 0;
    for (const file of Object.values(this.state.files)) {
      if (file.status === 'failed') {
        file.status = 'pending';
        file.error = '';
        file.updatedAt = new Date().toISOString();
        count += 1;
      }
    }
    if (count > 0) {
      await this.#save();
    }
    return count;
  }

  async resetUploading() {
    let count = 0;
    for (const file of Object.values(this.state.files)) {
      if (file.status === 'uploading') {
        file.status = 'pending';
        file.updatedAt = new Date().toISOString();
        count += 1;
      }
    }
    if (count > 0) {
      await this.#save();
    }
    return count;
  }

  async pruneFilesExcept(keys) {
    const keep = keys instanceof Set ? keys : new Set(keys);
    let count = 0;
    for (const key of Object.keys(this.state.files)) {
      if (!keep.has(key)) {
        delete this.state.files[key];
        count += 1;
      }
    }
    if (count > 0) {
      await this.#save();
    }
    return count;
  }

  async addEvent(type, subject, message) {
    this.state.events.unshift({
      type,
      subject,
      message,
      at: new Date().toISOString()
    });
    this.#pruneEventsInMemory();
    await this.#save();
  }

  async listEvents(limit = 50) {
    return structuredClone(this.state.events.slice(0, limit));
  }

  async clearEvents() {
    const deleted = this.state.events.length;
    this.state.events = [];
    if (deleted > 0) {
      await this.#save();
    }
    return deleted;
  }

  async pruneEvents() {
    const before = this.state.events.length;
    this.#pruneEventsInMemory();
    const deleted = before - this.state.events.length;
    if (deleted > 0) {
      await this.#save();
    }
    return deleted;
  }

  async stats() {
    const stats = {
      total: 0,
      synced: 0,
      failed: 0,
      pending: 0,
      uploading: 0,
      bytesSynced: 0
    };

    for (const file of Object.values(this.state.files)) {
      stats.total += 1;
      if (file.status === 'synced') {
        stats.synced += 1;
        stats.bytesSynced += Number(file.size || 0);
      } else if (file.status === 'failed') {
        stats.failed += 1;
      } else if (file.status === 'uploading') {
        stats.uploading += 1;
      } else {
        stats.pending += 1;
      }
    }
    return stats;
  }

  async #save() {
    const run = this.saveQueue.catch(() => undefined).then(() => this.#writeState());
    this.saveQueue = run;
    await run;
  }

  #pruneEventsInMemory() {
    const sync = this.state.config?.sync ?? {};
    const countLimit = clampInteger(sync.logRetentionCount, EVENT_LIMIT, 0, 10000);
    const dayLimit = clampInteger(sync.logRetentionDays, 30, 0, 3650);
    let events = this.state.events;
    if (dayLimit > 0) {
      const cutoff = Date.now() - dayLimit * 24 * 60 * 60 * 1000;
      events = events.filter((event) => {
        const time = new Date(event.at).getTime();
        return Number.isNaN(time) || time >= cutoff;
      });
    }
    if (countLimit > 0) {
      events = events.slice(0, countLimit);
    }
    this.state.events = events;
  }

  async #writeState() {
    const tmpPath = `${this.statePath}.${++this.saveCounter}.tmp`;
    const body = `${JSON.stringify(this.state, null, 2)}\n`;
    try {
      await writeFile(tmpPath, body, 'utf8');
      await rename(tmpPath, this.statePath);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}
