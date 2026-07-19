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
      CREATE TABLE IF NOT EXISTS task_remote_state (
        task_id TEXT PRIMARY KEY,
        remote_path TEXT NOT NULL DEFAULT '',
        remote_folder_id INTEGER,
        diffid INTEGER,
        last_scan_mode TEXT NOT NULL DEFAULT '',
        last_scan_at TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS restic_index_snapshots (
        task_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        ready INTEGER NOT NULL DEFAULT 0,
        snapshot_time TEXT NOT NULL DEFAULT '',
        entry_count INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        PRIMARY KEY (task_id, snapshot_id)
      );
      CREATE TABLE IF NOT EXISTS restic_index_entries (
        task_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        path TEXT NOT NULL,
        parent_path TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'file',
        size INTEGER NOT NULL DEFAULT 0,
        mtime TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (task_id, snapshot_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_restic_entries_parent
        ON restic_index_entries(task_id, snapshot_id, parent_path, type, name);
      CREATE TABLE IF NOT EXISTS restic_index_state (
        task_id TEXT PRIMARY KEY,
        active_snapshot_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'idle',
        checked_at TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL
      );
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

  async getTaskRemoteState(taskId) {
    const row = this.db.prepare('SELECT data FROM task_remote_state WHERE task_id = ?').get(String(taskId || ''));
    return row ? cloneJson(row.data) : null;
  }

  async listTaskRemoteStates() {
    const rows = this.db.prepare('SELECT data FROM task_remote_state ORDER BY task_id').all();
    return rows.map((row) => cloneJson(row.data));
  }

  async setTaskRemoteState(taskId, patch = {}) {
    const id = String(taskId || '').trim();
    if (!id) {
      throw new Error('Task remote state requires task id');
    }
    const previous = await this.getTaskRemoteState(id) ?? { taskId: id };
    const record = {
      ...previous,
      ...structuredClone(patch ?? {}),
      taskId: id,
      updatedAt: new Date().toISOString()
    };
    this.db.prepare(`
      INSERT INTO task_remote_state (task_id, remote_path, remote_folder_id, diffid, last_scan_mode, last_scan_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        remote_path = excluded.remote_path,
        remote_folder_id = excluded.remote_folder_id,
        diffid = excluded.diffid,
        last_scan_mode = excluded.last_scan_mode,
        last_scan_at = excluded.last_scan_at,
        data = excluded.data
    `).run(
      record.taskId,
      String(record.remotePath || ''),
      nullableInteger(record.remoteFolderId),
      nullableInteger(record.diffid),
      String(record.lastScanMode || ''),
      String(record.lastScanAt || ''),
      stringify(record)
    );
    return structuredClone(record);
  }

  async beginResticIndexBuild(taskId, snapshot = {}) {
    const id = requiredText(taskId, 'Restic index task id is required');
    const snapshotId = requiredText(snapshot.id, 'Restic snapshot id is required');
    this.#transaction(() => {
      this.db.prepare('DELETE FROM restic_index_entries WHERE task_id = ? AND snapshot_id = ?').run(id, snapshotId);
      this.db.prepare(`
        INSERT INTO restic_index_snapshots (task_id, snapshot_id, ready, snapshot_time, entry_count, data)
        VALUES (?, ?, 0, ?, 0, ?)
        ON CONFLICT(task_id, snapshot_id) DO UPDATE SET
          ready = 0,
          snapshot_time = excluded.snapshot_time,
          entry_count = 0,
          data = excluded.data
      `).run(id, snapshotId, String(snapshot.time || ''), stringify({ ...snapshot, id: snapshotId }));
    });
  }

  async appendResticIndexEntries(taskId, snapshotId, entries) {
    const id = requiredText(taskId, 'Restic index task id is required');
    const sid = requiredText(snapshotId, 'Restic snapshot id is required');
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO restic_index_entries
        (task_id, snapshot_id, path, parent_path, name, type, size, mtime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#transaction(() => {
      for (const entry of entries) {
        insert.run(id, sid, String(entry.path || ''), String(entry.parent || ''), String(entry.name || ''),
          String(entry.type || 'file'), Number(entry.size || 0), String(entry.mtime || ''));
      }
    });
    return entries.length;
  }

  async finishResticIndexBuild(taskId, snapshotId, patch = {}) {
    const id = requiredText(taskId, 'Restic index task id is required');
    const sid = requiredText(snapshotId, 'Restic snapshot id is required');
    const count = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM restic_index_entries WHERE task_id = ? AND snapshot_id = ?
    `).get(id, sid).count || 0);
    const row = this.db.prepare('SELECT data FROM restic_index_snapshots WHERE task_id = ? AND snapshot_id = ?').get(id, sid);
    if (!row) throw new Error('Restic index build was not started');
    const snapshot = { ...cloneJson(row.data), ...structuredClone(patch), id: sid, entryCount: count, ready: true };
    this.#transaction(() => {
      this.db.prepare(`
        UPDATE restic_index_snapshots SET ready = 1, entry_count = ?, data = ?
        WHERE task_id = ? AND snapshot_id = ?
      `).run(count, stringify(snapshot), id, sid);
      this.#writeResticIndexState(id, {
        ...(this.#readResticIndexState(id) ?? {}), taskId: id, activeSnapshotId: sid,
        status: 'ready', error: '', updatedAt: new Date().toISOString()
      });
    });
    return structuredClone(snapshot);
  }

  async abortResticIndexBuild(taskId, snapshotId, error = '') {
    const id = String(taskId || '');
    const sid = String(snapshotId || '');
    this.#transaction(() => {
      this.db.prepare('DELETE FROM restic_index_entries WHERE task_id = ? AND snapshot_id = ?').run(id, sid);
      this.db.prepare('DELETE FROM restic_index_snapshots WHERE task_id = ? AND snapshot_id = ? AND ready = 0').run(id, sid);
      this.#writeResticIndexState(id, {
        ...(this.#readResticIndexState(id) ?? {}), taskId: id, status: 'error', error: String(error || ''),
        updatedAt: new Date().toISOString()
      });
    });
  }

  async listResticSnapshotIndexes(taskId) {
    return this.db.prepare(`
      SELECT data FROM restic_index_snapshots WHERE task_id = ? AND ready = 1
      ORDER BY snapshot_time DESC, snapshot_id DESC
    `).all(String(taskId || '')).map((row) => cloneJson(row.data));
  }

  async getResticSnapshotIndex(taskId, snapshotId) {
    const row = this.db.prepare(`
      SELECT data FROM restic_index_snapshots WHERE task_id = ? AND snapshot_id = ? AND ready = 1
    `).get(String(taskId || ''), String(snapshotId || ''));
    return row ? cloneJson(row.data) : null;
  }

  async updateResticSnapshotIndex(taskId, snapshotId, patch = {}) {
    const id = String(taskId || '');
    const sid = String(snapshotId || '');
    const row = this.db.prepare('SELECT data FROM restic_index_snapshots WHERE task_id = ? AND snapshot_id = ? AND ready = 1').get(id, sid);
    if (!row) throw new Error('Restic snapshot index not found');
    const snapshot = { ...cloneJson(row.data), ...structuredClone(patch), id: sid };
    this.db.prepare('UPDATE restic_index_snapshots SET data = ? WHERE task_id = ? AND snapshot_id = ?').run(stringify(snapshot), id, sid);
    return structuredClone(snapshot);
  }

  async pruneResticSnapshotIndexes(taskId, keepSnapshotIds) {
    const id = String(taskId || '');
    const keep = new Set([...keepSnapshotIds].map(String));
    const rows = this.db.prepare('SELECT snapshot_id FROM restic_index_snapshots WHERE task_id = ?').all(id);
    let removed = 0;
    this.#transaction(() => {
      for (const row of rows) {
        if (keep.has(row.snapshot_id)) continue;
        this.db.prepare('DELETE FROM restic_index_entries WHERE task_id = ? AND snapshot_id = ?').run(id, row.snapshot_id);
        removed += Number(this.db.prepare('DELETE FROM restic_index_snapshots WHERE task_id = ? AND snapshot_id = ?').run(id, row.snapshot_id).changes || 0);
      }
    });
    return removed;
  }

  async browseResticSnapshotIndex(taskId, snapshotId, parentPath = '') {
    return this.db.prepare(`
      SELECT path, parent_path, name, type, size, mtime
      FROM restic_index_entries
      WHERE task_id = ? AND snapshot_id = ? AND parent_path = ?
      ORDER BY CASE type WHEN 'folder' THEN 0 ELSE 1 END, name
    `).all(String(taskId || ''), String(snapshotId || ''), String(parentPath || '')).map((row) => ({
      path: row.path, parent: row.parent_path, name: row.name, type: row.type,
      size: Number(row.size || 0), mtime: row.mtime
    }));
  }

  resticIndexEntries(taskId, snapshotId) {
    return this.db.prepare(`
      SELECT path, parent_path, name, type, size, mtime
      FROM restic_index_entries WHERE task_id = ? AND snapshot_id = ? ORDER BY path
    `).iterate(String(taskId || ''), String(snapshotId || ''));
  }

  async getResticIndexState(taskId) {
    return structuredClone(this.#readResticIndexState(String(taskId || '')) ?? { taskId: String(taskId || ''), status: 'empty' });
  }

  async setResticIndexState(taskId, patch = {}) {
    const id = requiredText(taskId, 'Restic index task id is required');
    const state = { ...(this.#readResticIndexState(id) ?? {}), ...structuredClone(patch), taskId: id, updatedAt: new Date().toISOString() };
    this.#writeResticIndexState(id, state);
    return structuredClone(state);
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

  #readResticIndexState(taskId) {
    const row = this.db.prepare('SELECT data FROM restic_index_state WHERE task_id = ?').get(taskId);
    return row ? cloneJson(row.data) : null;
  }

  #writeResticIndexState(taskId, state) {
    this.db.prepare(`
      INSERT INTO restic_index_state (task_id, active_snapshot_id, status, checked_at, data)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        active_snapshot_id = excluded.active_snapshot_id,
        status = excluded.status,
        checked_at = excluded.checked_at,
        data = excluded.data
    `).run(taskId, String(state.activeSnapshotId || ''), String(state.status || 'idle'), String(state.checkedAt || ''), stringify(state));
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

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function requiredText(value, message) {
  const text = String(value || '').trim();
  if (!text) throw new Error(message);
  return text;
}
