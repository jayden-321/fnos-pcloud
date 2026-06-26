import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

const OFFICIAL_HOSTS = new Set(['api.pcloud.com', 'eapi.pcloud.com']);
const TRANSIENT_RETRY_DELAYS_MS = [250, 1000];

export function validatePCloudHostname(hostname) {
  const value = String(hostname || '').trim();
  if (OFFICIAL_HOSTS.has(value) || /^(e?api)[a-z0-9-]*\.pcloud\.com$/.test(value)) {
    return value;
  }
  if (isLocalHttpUrl(value)) {
    return value;
  }
  throw new Error(`Unsupported pCloud API hostname: ${value}`);
}

export class PCloudClient {
  constructor({ hostname = 'api.pcloud.com', accessToken = '' } = {}) {
    this.hostname = validatePCloudHostname(hostname);
    this.accessToken = accessToken;
  }

  withHostname(hostname) {
    return new PCloudClient({ hostname, accessToken: this.accessToken });
  }

  async exchangeCode({ clientId, clientSecret, code }) {
    const response = await this.requestJson('oauth2_token', {
      client_id: clientId,
      client_secret: clientSecret,
      code
    }, { auth: false });

    return {
      accessToken: response.access_token,
      tokenType: response.token_type,
      uid: response.uid,
      hostname: response.hostname
    };
  }

  async userInfo() {
    return this.requestJson('userinfo');
  }

  async currentServer() {
    return this.requestJson('currentserver', {}, { auth: false });
  }

  async getApiServer() {
    return this.requestJson('getapiserver', {}, { auth: false });
  }

  async ensureFolder(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
      return { folderid: 0, path: '/' };
    }

    let currentPath = '';
    let metadata = null;
    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      const response = await this.requestJson('createfolderifnotexists', { path: currentPath });
      metadata = response.metadata;
    }
    return metadata;
  }

  async listRemoteFiles(remotePath) {
    const normalized = normalizeRemotePath(remotePath);
    let response;
    try {
      response = await this.requestJson('listfolder', {
        path: normalized,
        recursive: '1',
        nofiles: '0'
      });
    } catch (error) {
      if (error.result === 2005 || /does not exist/i.test(error.message)) {
        return new Map();
      }
      throw error;
    }

    const files = new Map();
    collectRemoteFiles(response.metadata, '', files);
    return files;
  }

  async listRemoteFolders(remotePath = '/') {
    const normalized = normalizeRemotePath(remotePath);
    let response;
    try {
      response = await this.requestJson('listfolder', {
        path: normalized,
        recursive: '0',
        nofiles: '1'
      });
    } catch (error) {
      if (error.result === 2005 || /does not exist/i.test(error.message)) {
        return { path: normalized, parent: parentRemotePath(normalized), entries: [] };
      }
      throw error;
    }

    const currentPath = normalizeRemotePath(response.metadata?.path || normalized);
    const entries = (response.metadata?.contents ?? [])
      .filter((item) => item.isfolder)
      .map((item) => ({
        name: item.name,
        path: normalizeRemotePath(item.path || `${currentPath}/${item.name}`),
        folderid: item.folderid ?? null
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { path: currentPath, parent: parentRemotePath(currentPath), entries };
  }

  async uploadProgress(progressHash) {
    return this.requestJson('uploadprogress', { progresshash: progressHash });
  }

  async checksumFile({ fileid = null, path: filePath = '' } = {}) {
    return this.requestJson('checksumfile', { fileid, path: filePath });
  }

  async diff(params = {}) {
    return this.requestJson('diff', params);
  }

  async uploadFile({ filePath, filename = path.basename(filePath), folderid, remotePath, mtime, progressHash, onProgress, signal }) {
    const fields = {
      access_token: this.accessToken,
      nopartial: '1'
    };
    if (folderid !== undefined && folderid !== null) {
      fields.folderid = String(folderid);
    } else if (remotePath) {
      fields.path = remotePath;
    }
    if (mtime) {
      fields.mtime = String(mtime);
    }
    if (progressHash) {
      fields.progresshash = progressHash;
    }
    return this.multipartUpload('/uploadfile', fields, filePath, filename, onProgress, signal);
  }

  async requestJson(method, params = {}, options = {}) {
    const url = this.urlFor(`/${method}`);
    const search = new URLSearchParams();
    if (options.auth !== false) {
      this.#requireToken();
      search.set('access_token', this.accessToken);
    }
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        search.set(key, String(value));
      }
    }
    url.search = search.toString();

    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok || body.result !== 0) {
      const error = new Error(body.error || `pCloud API request failed: ${method}`);
      error.result = body.result;
      error.statusCode = response.status;
      throw error;
    }
    return body;
  }

  async multipartUpload(urlPath, fields, filePath, filename, onProgress = null, signal = null) {
    this.#requireToken();
    return retryTransient(() => this.#multipartUploadOnce(urlPath, fields, filePath, filename, onProgress, signal));
  }

  async #multipartUploadOnce(urlPath, fields, filePath, filename, onProgress, signal) {
    if (signal?.aborted) {
      throw uploadStoppedError();
    }

    const url = this.urlFor(urlPath);
    const boundary = `pcloud-nas-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const transport = url.protocol === 'http:' ? http : https;
    const fieldParts = Object.entries(fields).map(([key, value]) => (
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="${escapeHeader(key)}"\r\n\r\n`
      + `${value}\r\n`
    ));
    const fileHeader = `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${escapeHeader(filename)}"\r\n`
      + 'Content-Type: application/octet-stream\r\n\r\n';
    const fileFooter = `\r\n--${boundary}--\r\n`;
    const fileSize = (await stat(filePath)).size;
    const contentLength = fieldParts.reduce((total, part) => total + Buffer.byteLength(part), 0)
      + Buffer.byteLength(fileHeader)
      + fileSize
      + Buffer.byteLength(fileFooter);

    return new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(contentLength)
        }
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (response.statusCode < 200 || response.statusCode >= 300 || parsed.result !== 0) {
              fail(new Error(parsed.error || 'pCloud upload failed'));
              return;
            }
            settle(() => resolve(parsed));
          } catch (error) {
            fail(error);
          }
        });
      });

      let settled = false;
      let stream = null;
      const abortUpload = () => {
        fail(uploadStoppedError());
      };
      signal?.addEventListener('abort', abortUpload, { once: true });

      function settle(action) {
        if (settled) {
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', abortUpload);
        action();
      }

      function fail(error) {
        settle(() => {
          stream?.destroy();
          request.destroy();
          reject(error);
        });
      }

      request.on('error', fail);
      for (const part of fieldParts) {
        request.write(part);
      }
      request.write(fileHeader);
      stream = createReadStream(filePath);
      stream.on('error', fail);
      stream.on('data', (chunk) => {
        onProgress?.(chunk.length, fileSize);
      });
      stream.on('end', () => {
        if (settled) {
          return;
        }
        request.write(fileFooter);
        request.end();
      });
      stream.pipe(request, { end: false });
    });
  }

  urlFor(urlPath) {
    const base = isLocalHttpUrl(this.hostname) ? this.hostname : `https://${this.hostname}`;
    return new URL(urlPath, base);
  }

  #requireToken() {
    if (!this.accessToken) {
      throw new Error('pCloud access token is not configured');
    }
  }
}

function isLocalHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function normalizeRemotePath(value) {
  const parts = String(value || '/')
    .trim()
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Remote path cannot contain relative path segments');
  }
  return `/${parts.join('/')}`;
}

function parentRemotePath(value) {
  const normalized = normalizeRemotePath(value);
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return `/${parts.join('/')}`;
}

function collectRemoteFiles(metadata, relativeDir, files) {
  for (const item of metadata?.contents ?? []) {
    const relativePath = joinRelative(relativeDir, item.name);
    if (item.isfolder) {
      collectRemoteFiles(item, relativePath, files);
      continue;
    }
    files.set(relativePath, {
      relativePath,
      path: item.path || '',
      size: Number(item.size || 0),
      mtime: parseRemoteMtime(item),
      mtimeMs: parseRemoteMtime(item) * 1000,
      hash: item.hash === undefined || item.hash === null ? '' : String(item.hash),
      fileid: item.fileid ?? null
    });
  }
}

function joinRelative(...parts) {
  return parts
    .join('/')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function parseRemoteMtime(item) {
  if (Number.isFinite(Number(item?.mtime))) {
    return Number(item.mtime);
  }
  if (item?.modified) {
    const parsed = Date.parse(item.modified);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed / 1000);
    }
  }
  return 0;
}

async function retryTransient(fn) {
  let lastError;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isAbortError(error) || !isTransientNetworkError(error) || attempt === TRANSIENT_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await delay(TRANSIENT_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

function isTransientNetworkError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNABORTED'].includes(code)
    || message.includes('socket hang up')
    || message.includes('network');
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

function uploadStoppedError() {
  const error = new Error('Upload stopped');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHeader(value) {
  return String(value).replaceAll('"', '%22').replaceAll('\r', '').replaceAll('\n', '');
}
