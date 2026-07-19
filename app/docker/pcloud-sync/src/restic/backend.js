import { createReadStream, createWriteStream } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { normalizeConfig } from '../config/config.js';
import { PCloudClient } from '../pcloud/client.js';

const TYPES = new Set(['data', 'keys', 'locks', 'snapshots', 'index']);

export class ResticPCloudBackend {
  constructor({ store, dataDir = store?.dataDir || '/data', pcloudFactory = null, port = 18081 } = {}) {
    this.store = store;
    this.dataDir = dataDir;
    this.pcloudFactory = pcloudFactory ?? ((config) => new PCloudClient(config.pcloud));
    this.port = port;
    this.server = null;
    this.uploadChain = Promise.resolve();
  }

  async start() {
    await mkdir(this.tempRoot(), { recursive: true, mode: 0o700 });
    if (this.server) return;
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        if (!response.headersSent) response.writeHead(error.statusCode || 500, { 'content-type': 'text/plain; charset=utf-8' });
        response.end(error.message);
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', resolve);
    });
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }

  repositoryUrl(taskId) {
    return `rest:http://127.0.0.1:${this.port}/${encodeURIComponent(taskId)}/`;
  }

  async handle(request, response) {
    const url = new URL(request.url, `http://127.0.0.1:${this.port}`);
    const route = await this.route(url.pathname);
    const client = this.pcloudFactory(route.config);
    response.setHeader('accept-ranges', 'bytes');

    if (request.method === 'POST' && url.searchParams.get('create') === 'true' && route.kind === 'root') {
      await this.createRepository(client, route.remoteRoot);
      response.writeHead(200);
      response.end();
      return;
    }

    if (request.method === 'GET' && route.kind === 'root') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('pCloud NAS Sync Restic backend\n');
      return;
    }

    if (request.method === 'GET' && route.kind === 'list') {
      const tree = await client.listRemoteTree(`${route.remoteRoot}/${route.type}`);
      const entries = [...tree.files.values()].map((item) => ({
        name: path.posix.basename(item.relativePath),
        size: item.size
      }));
      response.writeHead(200, { 'content-type': 'application/vnd.x.restic.rest.v2' });
      response.end(JSON.stringify(entries));
      return;
    }

    if (request.method === 'POST' && route.kind === 'object') {
      await this.uploadObject(request, client, route.remotePath);
      response.writeHead(200);
      response.end();
      return;
    }

    if (request.method === 'HEAD' && route.kind === 'object') {
      const metadata = await pcloudStat(client, route.remotePath);
      response.writeHead(200, { 'content-length': String(metadata.size || 0) });
      response.end();
      return;
    }

    if (request.method === 'GET' && route.kind === 'object') {
      await this.downloadObject(request, response, client, route.remotePath);
      return;
    }

    if (request.method === 'DELETE' && route.kind === 'object') {
      await client.deleteFile({ path: route.remotePath });
      response.writeHead(200);
      response.end();
      return;
    }

    throw httpError('Unsupported Restic backend operation', 405);
  }

  async route(pathname) {
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const taskId = parts.shift();
    if (!taskId) throw httpError('Missing Restic task', 404);
    const config = normalizeConfig(await this.store.loadConfig() ?? {});
    const task = config.tasks.find((item) => item.id === taskId && item.mode === 'restic');
    if (!task) throw httpError('Restic task not found', 404);
    const remoteRoot = normalizeRemote(task.remotePath);
    if (parts.length === 0) return { kind: 'root', config, remoteRoot };
    if (parts[0] === 'config' && parts.length === 1) {
      return { kind: 'object', config, remoteRoot, remotePath: `${remoteRoot}/config` };
    }
    const type = parts[0];
    if (!TYPES.has(type)) throw httpError('Invalid Restic object type', 404);
    if (parts.length === 1) return { kind: 'list', config, remoteRoot, type };
    if (parts.length !== 2 || !/^[a-f0-9]+$/i.test(parts[1])) throw httpError('Invalid Restic object name', 400);
    const name = parts[1];
    const shard = type === 'data' ? `/${name.slice(0, 2)}` : '';
    return { kind: 'object', config, remoteRoot, type, name, remotePath: `${remoteRoot}/${type}${shard}/${name}` };
  }

  async createRepository(client, remoteRoot) {
    await Promise.all(['data', 'keys', 'locks', 'snapshots', 'index'].map((type) => client.ensureFolder(`${remoteRoot}/${type}`)));
  }

  async uploadObject(request, client, remotePath) {
    const tempPath = path.join(this.tempRoot(), randomUUID());
    try {
      await pipeline(request, createWriteStream(tempPath, { mode: 0o600 }));
      const folder = await client.ensureFolder(path.posix.dirname(remotePath));
      await this.serializeUpload(() => client.uploadFile({
          filePath: tempPath,
          filename: path.posix.basename(remotePath),
          folderid: folder.folderid,
          mtime: Math.trunc(Date.now() / 1000)
        }));
    } finally {
      await rm(tempPath, { force: true }).catch(() => {});
    }
  }

  async downloadObject(request, response, client, remotePath) {
    const link = await client.getFileLink({ path: remotePath });
    const url = pcloudDownloadUrl(link, client.hostname);
    const headers = {};
    if (request.headers.range) headers.range = request.headers.range;
    const upstream = await fetch(url, { headers });
    if (!upstream.ok || !upstream.body) throw httpError(`pCloud download failed: ${upstream.status}`, upstream.status);
    const responseHeaders = {};
    for (const name of ['content-length', 'content-range', 'content-type']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders[name] = value;
    }
    response.writeHead(upstream.status, responseHeaders);
    await pipeline(Readable.fromWeb(upstream.body), response);
  }

  tempRoot() {
    return path.join(this.dataDir, 'restic', 'backend-upload');
  }

  serializeUpload(operation) {
    const current = this.uploadChain.then(operation, operation);
    this.uploadChain = current.catch(() => {});
    return current;
  }
}

async function pcloudStat(client, remotePath) {
  try {
    return (await client.stat({ path: remotePath })).metadata || {};
  } catch (error) {
    if (error.result === 2005 || /does not exist|not found/i.test(error.message)) throw httpError('Restic object not found', 404);
    throw error;
  }
}

function pcloudDownloadUrl(link, hostname) {
  const host = Array.isArray(link?.hosts) ? link.hosts[0] : link?.host;
  if (!host || !link?.path) throw new Error('pCloud did not return a download link');
  const protocol = String(hostname).startsWith('http://') ? 'http:' : 'https:';
  return /^https?:\/\//i.test(host) ? new URL(link.path, host) : new URL(`${protocol}//${host}${link.path}`);
}

function normalizeRemote(value) {
  const parts = String(value || '').replaceAll('\\', '/').split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) throw httpError('Invalid Restic remote path', 400);
  return `/${parts.join('/')}`;
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
