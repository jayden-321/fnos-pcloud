import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ResticPCloudBackend } from '../src/restic/backend.js';

test('Restic pCloud backend streams bounded concurrent uploads and supports v2 list, range reads, and deletes', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'restic-backend-'));
  const objects = new Map();
  let activeUploads = 0;
  let maxActiveUploads = 0;
  const downloadServer = createServer((request, response) => {
    const body = objects.get(new URL(request.url, 'http://local').pathname);
    const range = request.headers.range;
    if (range) {
      const start = Number(range.match(/bytes=(\d+)-/)?.[1] || 0);
      response.writeHead(206, { 'content-range': `bytes ${start}-${body.length - 1}/${body.length}`, 'content-length': body.length - start });
      response.end(body.subarray(start));
      return;
    }
    response.writeHead(200, { 'content-length': body.length });
    response.end(body);
  });
  await new Promise((resolve) => downloadServer.listen(0, '127.0.0.1', resolve));
  const downloadBase = `http://127.0.0.1:${downloadServer.address().port}`;
  const fakeClient = {
    hostname: downloadBase,
    ensureFolder: async (remotePath) => ({ folderid: remotePath }),
    uploadStream: async ({ stream, size, filename, folderid }) => {
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      try {
        const chunks = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        assert.equal(body.length, size);
        await new Promise((resolve) => setTimeout(resolve, 10));
        objects.set(`${folderid}/${filename}`, body);
        return {};
      } finally {
        activeUploads -= 1;
      }
    },
    listRemoteTree: async (remotePath) => ({
      files: new Map([...objects.entries()].filter(([name]) => name.startsWith(`${remotePath}/`)).map(([name, body]) => [name, { relativePath: name.slice(remotePath.length + 1), size: body.length }]))
    }),
    stat: async ({ path: remotePath }) => {
      const body = objects.get(remotePath);
      if (!body) throw Object.assign(new Error('not found'), { result: 2005 });
      return { metadata: { size: body.length } };
    },
    getFileLink: async ({ path: remotePath }) => ({ hosts: [`127.0.0.1:${downloadServer.address().port}`], path: remotePath }),
    deleteFile: async ({ path: remotePath }) => { objects.delete(remotePath); }
  };
  const store = {
    dataDir,
    loadConfig: async () => ({
      pcloud: { accessToken: 'test' },
      tasks: [{ id: 'test', mode: 'restic', localPath: '/vol1/test', remotePath: '/repo/test' }]
    })
  };
  const backend = new ResticPCloudBackend({ store, dataDir, port: 0, uploadConcurrency: 2, pcloudFactory: () => fakeClient });
  await backend.start();
  backend.port = backend.server.address().port;
  const base = backend.repositoryUrl('test').replace(/^rest:/, '');
  try {
    assert.equal((await fetch(`${base}?create=true`, { method: 'POST' })).status, 200);
    const name = 'abcdef1234';
    assert.equal((await fetch(`${base}data/${name}`, { method: 'POST', body: 'hello-restic' })).status, 200);
    assert.equal(objects.get(`/repo/test/data/ab/${name}`).toString(), 'hello-restic');
    const listed = await (await fetch(`${base}data/`, { headers: { accept: 'application/vnd.x.restic.rest.v2' } })).json();
    assert.deepEqual(listed, [{ name, size: 12 }]);
    const head = await fetch(`${base}data/${name}`, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '12');
    const ranged = await fetch(`${base}data/${name}`, { headers: { range: 'bytes=6-' } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), 'restic');
    await Promise.all(['bb00000001', 'bb00000002', 'bb00000003', 'bb00000004', 'bb00000005'].map((item, index) => (
      fetch(`${base}data/${item}`, { method: 'POST', body: `body-${index}` })
    )));
    assert.equal(maxActiveUploads, 2);
    assert.deepEqual(await readdir(path.join(dataDir, 'restic', 'backend-upload')), []);
    assert.equal((await fetch(`${base}data/${name}`, { method: 'DELETE' })).status, 200);
    assert.equal(objects.has(`/repo/test/data/ab/${name}`), false);
  } finally {
    await backend.stop();
    downloadServer.close();
  }
});

test('Restic pCloud backend falls back to a staged upload when request length is unavailable', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'restic-backend-fallback-'));
  let uploaded = '';
  const fakeClient = {
    ensureFolder: async (remotePath) => ({ folderid: remotePath }),
    uploadFile: async ({ filePath }) => {
      uploaded = await readFile(filePath, 'utf8');
      return {};
    }
  };
  const store = { dataDir, loadConfig: async () => ({ tasks: [] }) };
  const backend = new ResticPCloudBackend({ store, dataDir, port: 0, pcloudFactory: () => fakeClient });
  await backend.start();
  const source = Readable.from(['fallback-body']);
  source.headers = {};
  try {
    await backend.uploadObject(source, fakeClient, '/repo/test/data/fa/fallback');
    assert.equal(uploaded, 'fallback-body');
    assert.deepEqual(await readdir(path.join(dataDir, 'restic', 'backend-upload')), []);
  } finally {
    await backend.stop();
  }
});
