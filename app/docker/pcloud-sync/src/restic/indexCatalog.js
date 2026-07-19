import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import readline from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { PCloudClient } from '../pcloud/client.js';

const scrypt = promisify(scryptCallback);
const FORMAT_VERSION = 1;
const INDEX_BATCH_SIZE = 5000;

export class ResticIndexCatalog {
  constructor({ store, dataDir = store?.dataDir || '/data', pcloudFactory = null } = {}) {
    this.store = store;
    this.dataDir = dataDir;
    this.pcloudFactory = pcloudFactory ?? ((config) => new PCloudClient(config.pcloud));
    this.reconcileJobs = new Map();
  }

  async buildLocal(task, snapshot, lines) {
    await this.store.beginResticIndexBuild(task.id, snapshot);
    let batch = [];
    try {
      for await (const line of lines) {
        const raw = typeof line === 'string' ? JSON.parse(line) : line;
        const entry = indexEntry(task, raw);
        if (!entry) continue;
        batch.push(entry);
        if (batch.length >= INDEX_BATCH_SIZE) {
          await this.store.appendResticIndexEntries(task.id, snapshot.id, batch);
          batch = [];
        }
      }
      if (batch.length) await this.store.appendResticIndexEntries(task.id, snapshot.id, batch);
      return await this.store.finishResticIndexBuild(task.id, snapshot.id, { indexedAt: new Date().toISOString(), source: 'restic' });
    } catch (error) {
      await this.store.abortResticIndexBuild(task.id, snapshot.id, error.message);
      throw error;
    }
  }

  async createBuilder(task, snapshot) {
    await this.store.beginResticIndexBuild(task.id, snapshot);
    let batch = [];
    let failed = false;
    return {
      push: (line) => {
        if (failed) return;
        const raw = typeof line === 'string' ? JSON.parse(line) : line;
        const entry = indexEntry(task, raw);
        if (!entry) return;
        batch.push(entry);
        if (batch.length >= INDEX_BATCH_SIZE) {
          const pending = batch;
          batch = [];
          this.store.appendResticIndexEntries(task.id, snapshot.id, pending);
        }
      },
      finish: async () => {
        if (batch.length) await this.store.appendResticIndexEntries(task.id, snapshot.id, batch);
        return this.store.finishResticIndexBuild(task.id, snapshot.id, { indexedAt: new Date().toISOString(), source: 'restic' });
      },
      abort: async (error) => {
        failed = true;
        batch = [];
        await this.store.abortResticIndexBuild(task.id, snapshot.id, error?.message || String(error || ''));
      }
    };
  }

  async publish(task, snapshotId, config) {
    const snapshot = await this.store.getResticSnapshotIndex(task.id, snapshotId);
    if (!snapshot) throw new Error('本地快照索引尚未建立');
    const password = await this.password(task.id);
    const tempDir = await this.ensureTempDir(task.id);
    const indexFilename = `${snapshot.id}.index.ndjson.gz.enc`;
    const indexPath = path.join(tempDir, indexFilename);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveIndexKey(password, salt);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const source = Readable.from(indexLines(this.store, task.id, snapshot));
    try {
      await pipeline(source, createGzip({ level: 9 }), cipher, createWriteStream(indexPath, { mode: 0o600 }));
      const indexHash = await sha256File(indexPath);
      const tag = cipher.getAuthTag();
      const remoteBase = this.remoteBase(task);
      const client = this.pcloudFactory(config);
      const indexFolder = await client.ensureFolder(`${remoteBase}/indexes`);
      await client.uploadFile({ filePath: indexPath, filename: indexFilename, folderid: indexFolder.folderid });

      const indexSize = (await stat(indexPath)).size;
      await this.store.updateResticSnapshotIndex(task.id, snapshot.id, {
        cloudIndexFile: `indexes/${indexFilename}`,
        cloudIndexSha256: indexHash,
        cloudIndexSize: indexSize,
        cloudPublishedAt: new Date().toISOString()
      });
      const snapshots = await this.store.listResticSnapshotIndexes(task.id);
      const unsigned = {
        version: FORMAT_VERSION,
        taskId: task.id,
        repositoryPath: task.remotePath,
        latestSnapshotId: snapshot.id,
        generation: Date.now(),
        updatedAt: new Date().toISOString(),
        latestIndex: {
          file: `indexes/${indexFilename}`,
          sha256: indexHash,
          salt: salt.toString('base64'),
          iv: iv.toString('base64'),
          tag: tag.toString('base64'),
          entryCount: Number(snapshot.entryCount || 0),
          time: snapshot.time || ''
        },
        snapshots: snapshots.map(snapshotSummary)
      };
      const catalog = { ...unsigned, signature: await signCatalog(password, task.id, unsigned) };
      const catalogPath = path.join(tempDir, 'catalog.json');
      await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`, { mode: 0o600 });
      const catalogFolder = await client.ensureFolder(remoteBase);
      await client.uploadFile({ filePath: catalogPath, filename: 'catalog.json', folderid: catalogFolder.folderid });
      await this.store.setResticIndexState(task.id, {
        activeSnapshotId: snapshot.id,
        cloudSnapshotId: snapshot.id,
        status: 'ready',
        checkedAt: new Date().toISOString(),
        error: ''
      });
      return { snapshotId: snapshot.id, entryCount: snapshot.entryCount, remoteBase };
    } finally {
      await rm(indexPath, { force: true }).catch(() => {});
      await rm(path.join(tempDir, 'catalog.json'), { force: true }).catch(() => {});
    }
  }

  reconcile(task, config) {
    if (this.reconcileJobs.has(task.id)) return this.reconcileJobs.get(task.id);
    const promise = this.#reconcile(task, config).finally(() => this.reconcileJobs.delete(task.id));
    this.reconcileJobs.set(task.id, promise);
    return promise;
  }

  async #reconcile(task, config) {
    if (!await this.passwordConfigured(task.id)) return { status: 'password-required' };
    await this.store.setResticIndexState(task.id, { status: 'checking', error: '' });
    const password = await this.password(task.id);
    const client = this.pcloudFactory(config);
    const tempDir = await this.ensureTempDir(task.id);
    const catalogPath = path.join(tempDir, `catalog-${Date.now()}.json`);
    try {
      try {
        await client.downloadFile({ path: `${this.remoteBase(task)}/catalog.json`, filePath: catalogPath });
      } catch (error) {
        if (error.result === 2005 || /does not exist|not found/i.test(error.message)) {
          await this.store.setResticIndexState(task.id, { status: 'missing-cloud-index', checkedAt: new Date().toISOString() });
          return { status: 'missing-cloud-index' };
        }
        throw error;
      }
      const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
      await verifyCatalog(password, task, catalog);
      const local = await this.store.getResticSnapshotIndex(task.id, catalog.latestSnapshotId);
      if (local) {
        await this.store.setResticIndexState(task.id, {
          activeSnapshotId: local.id, cloudSnapshotId: catalog.latestSnapshotId,
          status: 'ready', checkedAt: new Date().toISOString(), error: ''
        });
        return { status: 'matched', snapshotId: local.id };
      }
      await this.store.setResticIndexState(task.id, { status: 'downloading', cloudSnapshotId: catalog.latestSnapshotId });
      const encryptedPath = path.join(tempDir, path.basename(catalog.latestIndex.file));
      await client.downloadFile({ path: `${this.remoteBase(task)}/${catalog.latestIndex.file}`, filePath: encryptedPath });
      if (await sha256File(encryptedPath) !== catalog.latestIndex.sha256) throw new Error('云端索引哈希校验失败');
      const snapshot = catalog.snapshots.find((item) => item.id === catalog.latestSnapshotId) ?? {
        id: catalog.latestSnapshotId, time: catalog.latestIndex.time || ''
      };
      await this.importEncrypted(task, snapshot, encryptedPath, catalog.latestIndex, password);
      await this.store.setResticIndexState(task.id, {
        activeSnapshotId: snapshot.id, cloudSnapshotId: snapshot.id,
        status: 'ready', checkedAt: new Date().toISOString(), error: ''
      });
      await rm(encryptedPath, { force: true }).catch(() => {});
      return { status: 'downloaded', snapshotId: snapshot.id };
    } catch (error) {
      await this.store.setResticIndexState(task.id, { status: 'error', error: error.message, checkedAt: new Date().toISOString() });
      throw error;
    } finally {
      await rm(catalogPath, { force: true }).catch(() => {});
    }
  }

  async importEncrypted(task, snapshot, encryptedPath, descriptor, password) {
    const key = await deriveIndexKey(password, Buffer.from(descriptor.salt, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(descriptor.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(descriptor.tag, 'base64'));
    const stream = createReadStream(encryptedPath).pipe(decipher).pipe(createGunzip());
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    await this.store.beginResticIndexBuild(task.id, snapshot);
    let batch = [];
    try {
      let headerSeen = false;
      for await (const line of lines) {
        if (!line) continue;
        const value = JSON.parse(line);
        if (!headerSeen) {
          if (value.kind !== 'header' || value.snapshot?.id !== snapshot.id) throw new Error('云端索引头与快照不匹配');
          headerSeen = true;
          continue;
        }
        batch.push(value);
        if (batch.length >= INDEX_BATCH_SIZE) {
          await this.store.appendResticIndexEntries(task.id, snapshot.id, batch);
          batch = [];
        }
      }
      if (batch.length) await this.store.appendResticIndexEntries(task.id, snapshot.id, batch);
      return await this.store.finishResticIndexBuild(task.id, snapshot.id, {
        ...snapshot, indexedAt: new Date().toISOString(), source: 'pcloud-index',
        cloudIndexFile: descriptor.file || ''
      });
    } catch (error) {
      await this.store.abortResticIndexBuild(task.id, snapshot.id, error.message);
      throw error;
    }
  }

  remoteBase(task) {
    const parent = path.posix.dirname(task.remotePath);
    return path.posix.join(parent, '.pcloud-nas-sync-index', safeId(task.id));
  }

  async ensureTempDir(taskId) {
    const directory = path.join(this.dataDir, 'restic', 'index-temp', safeId(taskId));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async password(taskId) {
    return (await readFile(this.passwordPath(taskId), 'utf8')).trimEnd();
  }

  async passwordConfigured(taskId) {
    try {
      return Boolean(await readFile(this.passwordPath(taskId)));
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  passwordPath(taskId) {
    return path.join(this.dataDir, 'restic', 'secrets', `${safeId(taskId)}.password`);
  }
}

async function* indexLines(store, taskId, snapshot) {
  yield `${JSON.stringify({ kind: 'header', version: FORMAT_VERSION, snapshot })}\n`;
  for (const row of store.resticIndexEntries(taskId, snapshot.id)) {
    yield `${JSON.stringify({ path: row.path, parent: row.parent_path, name: row.name, type: row.type, size: Number(row.size || 0), mtime: row.mtime })}\n`;
  }
}

function indexEntry(task, raw) {
  if (raw?.struct_type !== 'node') return null;
  const root = `/${task.localPath.replaceAll('\\', '/').split('/').filter(Boolean).join('/')}`;
  const absolute = String(raw.path || '');
  if (absolute === root) return null;
  if (!absolute.startsWith(`${root}/`)) return null;
  const relative = absolute.slice(root.length + 1);
  const parent = path.posix.dirname(relative) === '.' ? '' : path.posix.dirname(relative);
  return {
    path: relative,
    parent,
    name: raw.name || path.posix.basename(relative),
    type: raw.type === 'dir' ? 'folder' : 'file',
    size: Number(raw.size || 0),
    mtime: raw.mtime || ''
  };
}

function snapshotSummary(snapshot) {
  return {
    id: snapshot.id,
    shortId: snapshot.shortId || String(snapshot.id).slice(0, 8),
    time: snapshot.time || '',
    entryCount: Number(snapshot.entryCount || 0),
    indexFile: snapshot.cloudIndexFile || ''
  };
}

async function deriveIndexKey(password, salt) {
  return scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
}

async function signCatalog(password, taskId, value) {
  const key = await scrypt(password, `pcloud-nas-sync-catalog-v1:${taskId}`, 32, { N: 16384, r: 8, p: 1 });
  return createHmac('sha256', key).update(JSON.stringify(value)).digest('base64');
}

async function verifyCatalog(password, task, catalog) {
  const { signature, ...unsigned } = catalog || {};
  if (catalog?.version !== FORMAT_VERSION || catalog?.taskId !== task.id || catalog?.repositoryPath !== task.remotePath || !signature) {
    throw new Error('云端索引目录与当前任务不匹配');
  }
  const expected = Buffer.from(await signCatalog(password, task.id, unsigned), 'base64');
  const actual = Buffer.from(signature, 'base64');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('云端索引签名验证失败');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function safeId(value) {
  return String(value || 'task').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
}
