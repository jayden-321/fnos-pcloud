import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  decryptFile,
  encryptedRemotePath,
  encryptFile,
  generateMasterKey,
  loadOrCreateMasterKey
} from '../src/crypto/encryption.js';

test('encryptFile writes an AES-GCM envelope that decrypts back to the source bytes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-encryption-'));
  const sourcePath = path.join(dir, 'source.txt');
  const encryptedPath = path.join(dir, 'source.txt.pcenc');
  const decryptedPath = path.join(dir, 'decrypted.txt');
  await writeFile(sourcePath, 'hello encrypted world');

  const result = await encryptFile({
    sourcePath,
    targetPath: encryptedPath,
    masterKey: generateMasterKey()
  });
  await decryptFile({
    sourcePath: encryptedPath,
    targetPath: decryptedPath,
    masterKey: result.masterKey
  });

  const encrypted = await readFile(encryptedPath);
  assert.equal(encrypted.subarray(0, 8).toString('utf8'), 'PCNSENC1');
  assert.notDeepEqual(encrypted, await readFile(sourcePath));
  assert.equal(await readFile(decryptedPath, 'utf8'), 'hello encrypted world');
  assert.equal(result.plaintextSize, 21);
  assert.equal(result.ciphertextSize, encrypted.length);
  assert.match(result.plaintextSha1, /^[a-f0-9]{40}$/);
  assert.match(result.ciphertextSha1, /^[a-f0-9]{40}$/);
});

test('loadOrCreateMasterKey stores a reusable local key with owner-only permissions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pcloud-key-'));

  const first = await loadOrCreateMasterKey(dir);
  const second = await loadOrCreateMasterKey(dir);
  const keyFile = await stat(path.join(dir, 'encryption.key'));

  assert.deepEqual(second, first);
  assert.equal(first.length, 32);
  assert.equal(keyFile.mode & 0o077, 0);
});

test('encryptedRemotePath appends the pCloud encrypted-file suffix once', () => {
  assert.equal(encryptedRemotePath('/Sync/docs/a.txt'), '/Sync/docs/a.txt.pcenc');
  assert.equal(encryptedRemotePath('/Sync/docs/a.txt.pcenc'), '/Sync/docs/a.txt.pcenc');
});
