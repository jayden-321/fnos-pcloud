import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const STATE_DB = 'state.sqlite';
const EVENT_LIMIT = 300;

export class SqliteStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbPath = path.join(dataDir, STATE_DB);
    this.db = null;
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        key TEXT PRIMARY KEY,
        source_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        size INTEGER NOT NULL DEFAULT 0,
        mtime_ms INTEGER NOT NULL DEFAULT 0,
        remote_path TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_id);
      CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
    `);
  }

  async loadConfig() {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('config');
    return row ? cloneJson(row.value) : null;
  }

  async saveConfig(config) {
    this.db.prepare(`
      INSERT INTO kv (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('config', stringify(config));
  }

  async upsertFile(file) {
    const record = this.#mergedFile(file);
    this.#writeFile(record);
    return structuredClone(record);
  }

  async replaceFilesForSources(sourceIds, files) {
    const selected = Array.isArray(sourceIds)
      ? sourceIds.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const now = new Date().toISOString();

    this.#transaction(() => {
      if (selected.length > 0) {
        const deleteBySource = this.db.prepare('DELETE FROM files WHERE source_id = ? OR key LIKE ?');
        for (const sourceId of selected) {
          deleteBySource.run(sourceId, `${sourceId}/%`);
        }
      } else {
        this.db.prepare('DELETE FROM files').run();
      }

      for (const file of files) {
        this.#writeFile({
          ...structuredClone(requiredFile(file)),
          updatedAt: now
        });
      }
    });
    return files.length;
  }

  async getFile(key) {
    const row = this.db.prepare('SELECT data FROM files WHERE key = ?').get(key);
    return row ? cloneJson(row.data) : null;
  }

  async listFiles(filter = {}) {
    const { clause, params } = fileFilterClause(filter);
    const rows = this.db.prepare(`SELECT data FROM files ${clause} ORDER BY key`).all(...params);
    return rows.map((row) => cloneJson(row.data));
  }

  async fileMap() {
    const map = new Map();
    const rows = this.db.prepare('SELECT key, data FROM files').all();
    for (const row of rows) {
      map.set(row.key, cloneJson(row.data));
    }
    return map;
  }

  async setStatus(key, status, patch = {}) {
    const previous = await this.getFile(key);
    if (!previous) {
      throw new Error(`Unknown file record: ${key}`);
    }
    const record = {
      ...previous,
      ...structuredClone(patch),
      status,
      updatedAt: new Date().toISOString()
    };
    this.#writeFile(record);
    return structuredClone(record);
  }

  async resetFailed() {
    return this.#resetStatus('failed', 'pending', { error: '' });
  }

  async resetUploading() {
    return this.#resetStatus('uploading', 'pending');
  }

  async pruneFilesExcept(keys) {
    const keep = keys instanceof Set ? keys : new Set(keys);
    let count = 0;
    this.#transaction(() => {
      const rows = this.db.prepare('SELECT key FROM files').all();
      const deleteFile = this.db.prepare('DELETE FROM files WHERE key = ?');
      for (const row of rows) {
        if (!keep.has(row.key)) {
          deleteFile.run(row.key);
          count += 1;
        }
      }
    });
    return count;
  }

  async clearFiles(filter = {}) {
    const sourceIds = Array.isArray(filter.sourceIds) ? filter.sourceIds.filter(Boolean) : null;
    let count = 0;
    this.#transaction(() => {
      if (sourceIds?.length) {
        const deleteBySource = this.db.prepare('DELETE FROM files WHERE source_id = ? OR key LIKE ?');
        for (const sourceId of sourceIds) {
          const result = deleteBySource.run(sourceId, `${sourceId}/%`);
          count += Number(result.changes || 0);
        }
      } else {
        count = Number(this.db.prepare('DELETE FROM files').run().changes || 0);
      }
    });
    return count;
  }

  async addEvent(type, subject, message, details = {}) {
    const event = {
      ...structuredClone(details ?? {}),
      type,
      subject,
      message,
      at: new Date().toISOString()
    };
    this.db.prepare(`
      INSERT INTO events (type, subject, message, at, data)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.type, event.subject, event.message, event.at, stringify(event));
    await this.pruneEvents();
  }

  async listEvents(limit = 50) {
    const rows = this.db.prepare('SELECT data FROM events ORDER BY id DESC LIMIT ?').all(limit);
    return rows.map((row) => cloneJson(row.data));
  }

  async clearEvents() {
    return Number(this.db.prepare('DELETE FROM events').run().changes || 0);
  }

  async pruneEvents() {
    const before = Number(this.db.prepare('SELECT COUNT(*) AS count FROM events').get().count || 0);
    const config = await this.loadConfig() ?? {};
    const sync = config.sync ?? {};
    const countLimit = clampInteger(sync.logRetentionCount, EVENT_LIMIT, 0, 10000);
    const dayLimit = clampInteger(sync.logRetentionDays, 30, 0, 3650);
    const rows = this.db.prepare('SELECT id, data FROM events ORDER BY id DESC').all();
    const keep = new Set();

    for (const row of rows) {
      const event = cloneJson(row.data);
      let keepEvent = true;
      if (dayLimit > 0) {
        const cutoff = Date.now() - dayLimit * 24 * 60 * 60 * 1000;
        const time = new Date(event.at).getTime();
        keepEvent = Number.isNaN(time) || time >= cutoff;
      }
      if (keepEvent && (countLimit === 0 || keep.size < countLimit)) {
        keep.add(row.id);
      }
    }

    this.#transaction(() => {
      const deleteEvent = this.db.prepare('DELETE FROM events WHERE id = ?');
      for (const row of rows) {
        if (!keep.has(row.id)) {
          deleteEvent.run(row.id);
        }
      }
    });
    const after = Number(this.db.prepare('SELECT COUNT(*) AS count FROM events').get().count || 0);
    return before - after;
  }

  async stats(filter = {}) {
    const { clause, params } = fileFilterClause(filter);
    const rows = this.db.prepare(`SELECT status, size FROM files ${clause}`).all(...params);
    const stats = {
      total: 0,
      synced: 0,
      existing: 0,
      failed: 0,
      pending: 0,
      uploading: 0,
      bytesSynced: 0
    };

    for (const row of rows) {
      stats.total += 1;
      if (row.status === 'synced') {
        stats.synced += 1;
        stats.bytesSynced += Number(row.size || 0);
      } else if (row.status === 'existing') {
        stats.existing += 1;
      } else if (row.status === 'failed') {
        stats.failed += 1;
      } else if (row.status === 'uploading') {
        stats.uploading += 1;
      } else {
        stats.pending += 1;
      }
    }
    return stats;
  }

  close() {
    this.db?.close();
    this.db = null;
  }

  #mergedFile(file) {
    const required = requiredFile(file);
    const previous = this.db.prepare('SELECT data FROM files WHERE key = ?').get(required.key);
    return {
      ...(previous ? cloneJson(previous.data) : {}),
      ...structuredClone(required),
      updatedAt: new Date().toISOString()
    };
  }

  #writeFile(file) {
    const record = requiredFile(file);
    this.db.prepare(`
      INSERT INTO files (key, source_id, status, size, mtime_ms, remote_path, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        source_id = excluded.source_id,
        status = excluded.status,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        remote_path = excluded.remote_path,
        data = excluded.data
    `).run(
      record.key,
      sourceIdForFile(record),
      String(record.status || 'pending'),
      Number(record.size || 0),
      Number(record.mtimeMs || 0),
      String(record.remotePath || ''),
      stringify(record)
    );
  }

  #resetStatus(fromStatus, toStatus, patch = {}) {
    const files = this.db.prepare('SELECT data FROM files WHERE status = ?').all(fromStatus).map((row) => cloneJson(row.data));
    const now = new Date().toISOString();
    this.#transaction(() => {
      for (const file of files) {
        this.#writeFile({
          ...file,
          ...patch,
          status: toStatus,
          updatedAt: now
        });
      }
    });
    return files.length;
  }

  #transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      action();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function requiredFile(file) {
  if (!file?.key) {
    throw new Error('File record requires key');
  }
  return structuredClone(file);
}

function fileFilterClause(filter = {}) {
  const conditions = [];
  const params = [];
  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.sourceId) {
    conditions.push('(source_id = ? OR key LIKE ?)');
    params.push(filter.sourceId, `${filter.sourceId}/%`);
  }
  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

function sourceIdForFile(file) {
  return String(file.sourceId || String(file.key || '').split('/')[0] || '');
}

function cloneJson(value) {
  return JSON.parse(value);
}

function stringify(value) {
  return JSON.stringify(value);
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, min), max);
}
