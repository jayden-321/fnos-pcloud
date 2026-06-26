import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PCloudClient, validatePCloudHostname } from '../src/pcloud/client.js';

async function withServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test('validatePCloudHostname only allows official API hosts and local test URLs', () => {
  assert.equal(validatePCloudHostname('api.pcloud.com'), 'api.pcloud.com');
  assert.equal(validatePCloudHostname('eapi.pcloud.com'), 'eapi.pcloud.com');
  assert.equal(validatePCloudHostname('api7.pcloud.com'), 'api7.pcloud.com');
  assert.equal(validatePCloudHostname('api-ams1.pcloud.com'), 'api-ams1.pcloud.com');
  assert.throws(() => validatePCloudHostname('pcloud.example.com'), /Unsupported/);
});

test('PCloudClient exchanges OAuth code and creates folders through JSON API', async () => {
  const calls = [];
  const server = await withServer((req, res) => {
    calls.push(req.url);
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/oauth2_token')) {
      res.end(JSON.stringify({ result: 0, access_token: 'abc', token_type: 'bearer', uid: 1, hostname: 'eapi.pcloud.com' }));
      return;
    }
    if (req.url.startsWith('/createfolderifnotexists')) {
      res.end(JSON.stringify({ result: 0, metadata: { folderid: 42, path: '/NAS' } }));
      return;
    }
    res.end(JSON.stringify({ result: 0 }));
  });

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const token = await client.exchangeCode({ clientId: 'cid', clientSecret: 'sec', code: 'code' });
    const folder = await client.ensureFolder('/NAS');

    assert.equal(token.accessToken, 'abc');
    assert.equal(token.hostname, 'eapi.pcloud.com');
    assert.equal(folder.folderid, 42);
    assert.ok(calls[0].includes('client_id=cid'));
    assert.ok(calls[1].includes('access_token=token'));
    assert.ok(calls[1].includes('path=%2FNAS'));
  } finally {
    await server.close();
  }
});

test('PCloudClient creates nested folders parent-first', async () => {
  const paths = [];
  const server = await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    paths.push(url.searchParams.get('path'));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      result: 0,
      metadata: {
        folderid: paths.length,
        path: url.searchParams.get('path')
      }
    }));
  });

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const folder = await client.ensureFolder('/NAS/Docs/Invoices');

    assert.deepEqual(paths, ['/NAS', '/NAS/Docs', '/NAS/Docs/Invoices']);
    assert.equal(folder.path, '/NAS/Docs/Invoices');
  } finally {
    await server.close();
  }
});

test('PCloudClient lists remote files recursively by relative path', async () => {
  const calls = [];
  const server = await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push(url.pathname + url.search);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      result: 0,
      metadata: {
        isfolder: true,
        path: '/NAS/财务',
        contents: [
          {
            isfolder: false,
            name: 'a.txt',
            path: '/NAS/财务/a.txt',
            size: 5,
            modified: 'Fri, 26 Jun 2026 10:00:00 +0000',
            hash: 111
          },
          {
            isfolder: true,
            name: 'nested',
            path: '/NAS/财务/nested',
            contents: [
              {
                isfolder: false,
                name: 'b.txt',
                path: '/NAS/财务/nested/b.txt',
                size: 9,
                modified: 'Fri, 26 Jun 2026 10:01:00 +0000',
                hash: 222
              }
            ]
          }
        ]
      }
    }));
  });

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const remote = await client.listRemoteFiles('/NAS/财务');

    assert.deepEqual([...remote.keys()], ['a.txt', 'nested/b.txt']);
    assert.equal(remote.get('a.txt').size, 5);
    assert.equal(remote.get('a.txt').mtime, 1782468000);
    assert.equal(remote.get('nested/b.txt').hash, '222');
    assert.ok(calls[0].includes('/listfolder'));
    assert.ok(calls[0].includes('recursive=1'));
  } finally {
    await server.close();
  }
});

test('PCloudClient treats missing remote folders as an empty file list', async () => {
  const server = await withServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result: 2005, error: 'Directory does not exist.' }));
  });

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const remote = await client.listRemoteFiles('/NAS/missing');

    assert.equal(remote.size, 0);
  } finally {
    await server.close();
  }
});

test('PCloudClient lists immediate remote folders for picker navigation', async () => {
  const server = await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('content-type', 'application/json');
    assert.equal(url.pathname, '/listfolder');
    assert.equal(url.searchParams.get('recursive'), '0');
    assert.equal(url.searchParams.get('nofiles'), '1');
    res.end(JSON.stringify({
      result: 0,
      metadata: {
        folderid: 0,
        path: '/NAS',
        contents: [
          { isfolder: true, folderid: 11, name: '财务', path: '/NAS/财务' },
          { isfolder: false, fileid: 9, name: 'a.txt', path: '/NAS/a.txt' },
          { isfolder: true, folderid: 12, name: 'Photos', path: '/NAS/Photos' }
        ]
      }
    }));
  });

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const folders = await client.listRemoteFolders('/NAS');

    assert.deepEqual(folders, {
      path: '/NAS',
      parent: '/',
      entries: [
        { name: 'Photos', path: '/NAS/Photos', folderid: 12 },
        { name: '财务', path: '/NAS/财务', folderid: 11 }
      ]
    });
  } finally {
    await server.close();
  }
});

test('PCloudClient streams uploadfile multipart with nopartial and mtime', async () => {
  let body = '';
  const server = await withServer((req, res) => {
    req.setEncoding('binary');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: 0, fileids: [7], metadata: [{ fileid: 7, name: 'a.txt' }] }));
    });
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-upload-'));
  const filePath = path.join(dir, 'a.txt');
  await writeFile(filePath, 'hello');

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const result = await client.uploadFile({
      filePath,
      filename: 'a.txt',
      folderid: 42,
      mtime: 123,
      progressHash: 'progress-123'
    });

    assert.equal(result.fileids[0], 7);
    assert.match(body, /name="access_token"/);
    assert.match(body, /name="folderid"/);
    assert.match(body, /42/);
    assert.match(body, /name="nopartial"/);
    assert.match(body, /name="mtime"/);
    assert.match(body, /name="progresshash"/);
    assert.match(body, /progress-123/);
    assert.match(body, /filename="a.txt"/);
    assert.match(body, /hello/);
  } finally {
    await server.close();
  }
});

test('PCloudClient sends renameifexists when upload conflict renaming is enabled', async () => {
  let body = '';
  const server = await withServer((req, res) => {
    req.setEncoding('binary');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        result: 0,
        fileids: [17],
        metadata: [{ fileid: 17, name: 'rename (2).txt', path: '/NAS/rename (2).txt' }]
      }));
    });
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-upload-rename-'));
  const filePath = path.join(dir, 'rename.txt');
  await writeFile(filePath, 'hello');

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const result = await client.uploadFile({
      filePath,
      filename: 'rename.txt',
      folderid: 42,
      renameIfExists: true
    });

    assert.equal(result.fileids[0], 17);
    assert.match(body, /name="renameifexists"/);
    assert.match(body, /\r\n1\r\n/);
  } finally {
    await server.close();
  }
});

test('PCloudClient aborts an active multipart upload', async () => {
  const server = await withServer((req, res) => {
    req.resume();
    req.on('end', () => {
      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ result: 0, fileids: [8] }));
      }, 60);
    });
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-upload-abort-'));
  const filePath = path.join(dir, 'abort.txt');
  await writeFile(filePath, 'hello');

  try {
    const controller = new AbortController();
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const upload = client.uploadFile({
      filePath,
      filename: 'abort.txt',
      folderid: 42,
      signal: controller.signal
    });

    setTimeout(() => controller.abort(), 10);

    await assert.rejects(upload, /Upload stopped/);
  } finally {
    await server.close();
  }
});

test('PCloudClient wraps progress, checksum, diff, and server selection APIs', async () => {
  const calls = [];
  const server = await withServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push(url.pathname + url.search);
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/currentserver') {
      res.end(JSON.stringify({ result: 0, hostname: 'api7.pcloud.com' }));
      return;
    }
    if (url.pathname === '/getapiserver') {
      res.end(JSON.stringify({ result: 0, api: ['api7.pcloud.com', 'api.pcloud.com'] }));
      return;
    }
    if (url.pathname === '/uploadprogress') {
      res.end(JSON.stringify({ result: 0, uploaded: 10, total: 20, currentfileuploaded: 6 }));
      return;
    }
    if (url.pathname === '/checksumfile') {
      res.end(JSON.stringify({ result: 0, sha1: 'abc', md5: 'def' }));
      return;
    }
    if (url.pathname === '/stat') {
      res.end(JSON.stringify({ result: 0, metadata: { fileid: Number(url.searchParams.get('fileid')), path: '/NAS/a.txt' } }));
      return;
    }
    if (url.pathname === '/diff') {
      res.end(JSON.stringify({ result: 0, diffid: 42, entries: [] }));
      return;
    }
    res.end(JSON.stringify({ result: 0 }));
  });

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });

    assert.equal((await client.currentServer()).hostname, 'api7.pcloud.com');
    assert.deepEqual((await client.getApiServer()).api, ['api7.pcloud.com', 'api.pcloud.com']);
    assert.equal((await client.uploadProgress('progress-123')).currentfileuploaded, 6);
    assert.equal((await client.checksumFile({ path: '/NAS/a.txt' })).sha1, 'abc');
    assert.equal((await client.stat({ fileid: 7 })).metadata.path, '/NAS/a.txt');
    assert.equal((await client.diff({ diffid: 41 })).diffid, 42);
    assert.ok(calls.some((call) => call.includes('/uploadprogress') && call.includes('progresshash=progress-123')));
    assert.ok(calls.some((call) => call.includes('/checksumfile') && call.includes('path=%2FNAS%2Fa.txt')));
    assert.ok(calls.some((call) => call.includes('/stat') && call.includes('fileid=7')));
    assert.ok(calls.some((call) => call.includes('/diff') && call.includes('diffid=41')));
  } finally {
    await server.close();
  }
});

test('PCloudClient sends multipart uploads with a fixed content length', async () => {
  let headers = {};
  const server = await withServer((req, res) => {
    headers = req.headers;
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: 0, fileids: [8], metadata: [{ fileid: 8, name: 'b.txt' }] }));
    });
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-upload-length-'));
  const filePath = path.join(dir, 'b.txt');
  await writeFile(filePath, 'world');

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    await client.uploadFile({ filePath, filename: 'b.txt', folderid: 42 });

    assert.ok(Number(headers['content-length']) > 0);
    assert.equal(headers['transfer-encoding'], undefined);
  } finally {
    await server.close();
  }
});

test('PCloudClient retries transient multipart socket resets', async () => {
  let attempts = 0;
  const server = await withServer((req, res) => {
    attempts += 1;
    if (attempts === 1) {
      req.socket.destroy();
      return;
    }

    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ result: 0, fileids: [9], metadata: [{ fileid: 9, name: 'c.txt' }] }));
    });
  });
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-upload-retry-'));
  const filePath = path.join(dir, 'c.txt');
  await writeFile(filePath, 'again');

  try {
    const client = new PCloudClient({ hostname: server.baseUrl, accessToken: 'token' });
    const result = await client.uploadFile({ filePath, filename: 'c.txt', folderid: 42 });

    assert.equal(attempts, 2);
    assert.equal(result.fileids[0], 9);
  } finally {
    await server.close();
  }
});
