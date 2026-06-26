import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanSource } from '../src/scanner/scanner.js';

test('scanSource returns stable file candidates and applies ignore patterns', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-scan-'));
  await mkdir(path.join(dir, 'album'), { recursive: true });
  await writeFile(path.join(dir, 'album', 'a.jpg'), 'image');
  await writeFile(path.join(dir, 'album', 'skip.tmp'), 'tmp');
  await writeFile(path.join(dir, '.DS_Store'), 'noise');

  const files = await scanSource(
    { id: 'photos', localPath: dir, remotePath: '/NAS/Camera' },
    ['*.tmp', '.DS_Store']
  );

  assert.equal(files.length, 1);
  assert.equal(files[0].key, 'photos/album/a.jpg');
  assert.equal(files[0].relativePath, 'album/a.jpg');
  assert.equal(files[0].remotePath, '/NAS/Camera/album/a.jpg');
  assert.equal(files[0].size, 5);
});
