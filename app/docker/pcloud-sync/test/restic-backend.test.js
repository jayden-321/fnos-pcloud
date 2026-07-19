import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResticPCloudBackend } from '../src/restic/backend.js';

test('Restic pCloud backend stages uploads and supports v2 list, range reads, and deletes', async () => {
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
    uploadFile: async ({ filePath, filename, folderid }) => {
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);
      try {
        await new Promise((resolve) => setTimeout(resolve, 5));
        objects.set(`${folderid}/${filename}`, await readFile(filePath));
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
  const backend = new ResticPCloudBackend({ store, dataDir, port: 0, pcloudFactory: () => fakeClient });
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
    await Promise.all([
      fetch(`${base}data/bbcdef1234`, { method: 'POST', body: 'second' }),
      fetch(`${base}data/cccdef1234`, { method: 'POST', body: 'third' })
    ]);
    assert.equal(maxActiveUploads, 1);
    assert.equal((await fetch(`${base}data/${name}`, { method: 'DELETE' })).status, 200);
    assert.equal(objects.has(`/repo/test/data/ab/${name}`), false);
  } finally {
    await backend.stop();
    downloadServer.close();
  }
});
