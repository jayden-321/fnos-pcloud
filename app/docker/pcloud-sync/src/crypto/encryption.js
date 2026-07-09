import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const ENCRYPTED_FILE_SUFFIX = '.pcenc';

const MAGIC = Buffer.from('PCNSENC1');
const KEY_MAGIC = 'PCNSKEY1';
const HEADER_LENGTH_BYTES = 4;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const FILE_SALT_BYTES = 16;
const GCM_NONCE_BYTES = 12;
const KEY_FILE = 'encryption.key';

export function generateMasterKey() {
  return randomBytes(MASTER_KEY_BYTES);
}

export async function loadOrCreateMasterKey(dataDir) {
  const root = String(dataDir || '').trim();
  if (!root) {
    throw new Error('Encryption key directory is required');
  }
  await mkdir(root, { recursive: true });
  const keyPath = path.join(root, KEY_FILE);
  try {
    const key = parseKeyFile(await readFile(keyPath));
    await chmod(keyPath, 0o600).catch(() => {});
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const key = generateMasterKey();
  try {
    const handle = await open(keyPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${KEY_MAGIC}\n${key.toString('base64')}\n`);
    } finally {
      await handle.close();
    }
    await chmod(keyPath, 0o600).catch(() => {});
  } catch (error) {
    if (error.code === 'EEXIST') {
      return parseKeyFile(await readFile(keyPath));
    }
    throw error;
  }
  return key;
}

export async function loadMasterKey(dataDir) {
  const root = String(dataDir || '').trim();
  if (!root) {
    throw new Error('Encryption key directory is required');
  }
  try {
    const keyPath = path.join(root, KEY_FILE);
    const key = parseKeyFile(await readFile(keyPath));
    await chmod(keyPath, 0o600).catch(() => {});
    return key;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Encryption key is not configured');
    }
    throw error;
  }
}

export async function encryptFile({ sourcePath, targetPath, masterKey }) {
  assertMasterKey(masterKey);
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile()) {
    throw new Error('Encryption source must be a file');
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  const fileSalt = randomBytes(FILE_SALT_BYTES);
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const fileKey = deriveFileKey(masterKey, fileSalt);
  const header = {
    v: 1,
    alg: 'AES-256-GCM',
    kdf: 'HKDF-SHA256',
    fileSalt: fileSalt.toString('base64'),
    nonce: nonce.toString('base64')
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const prefix = Buffer.concat([MAGIC, uint32(headerBytes.length), headerBytes]);
  const plaintextHash = createHash('sha1');
  const cipher = createCipheriv('aes-256-gcm', fileKey, nonce);
  const out = createWriteStream(targetPath, { mode: 0o600 });

  try {
    await writeChunk(out, prefix);
    await pipeline(
      createReadStream(sourcePath),
      hashTransform(plaintextHash),
      cipher,
      out,
      { end: false }
    );
    await endWithChunk(out, cipher.getAuthTag());
  } catch (error) {
    out.destroy();
    await rm(targetPath, { force: true }).catch(() => {});
    throw error;
  }

  const encryptedInfo = await stat(targetPath);
  return {
    masterKey,
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'HKDF-SHA256',
    fileSalt: header.fileSalt,
    nonce: header.nonce,
    plaintextSize: Number(sourceInfo.size || 0),
    ciphertextSize: Number(encryptedInfo.size || 0),
    plaintextSha1: plaintextHash.digest('hex'),
    ciphertextSha1: await sha1File(targetPath)
  };
}

export async function decryptFile({ sourcePath, targetPath, masterKey }) {
  assertMasterKey(masterKey);
  const sourceInfo = await stat(sourcePath);
  const { header, ciphertextStart } = await readEnvelopeHeader(sourcePath);
  const tagStart = Number(sourceInfo.size || 0) - AUTH_TAG_BYTES;
  if (tagStart <= ciphertextStart) {
    throw new Error('Encrypted file is truncated');
  }

  const tag = await readFileSlice(sourcePath, tagStart, AUTH_TAG_BYTES);
  const fileSalt = Buffer.from(header.fileSalt || '', 'base64');
  const nonce = Buffer.from(header.nonce || '', 'base64');
  const fileKey = deriveFileKey(masterKey, fileSalt);
  const decipher = createDecipheriv('aes-256-gcm', fileKey, nonce);
  decipher.setAuthTag(tag);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await pipeline(
    createReadStream(sourcePath, { start: ciphertextStart, end: tagStart - 1 }),
    decipher,
    createWriteStream(targetPath, { mode: 0o600 })
  );
}

export function encryptedRemotePath(remotePath) {
  const normalized = String(remotePath || '').trim();
  if (!normalized || normalized.endsWith(ENCRYPTED_FILE_SUFFIX)) {
    return normalized;
  }
  return `${normalized}${ENCRYPTED_FILE_SUFFIX}`;
}

export function encryptedRelativePath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  if (!normalized || normalized.endsWith(ENCRYPTED_FILE_SUFFIX)) {
    return normalized;
  }
  return `${normalized}${ENCRYPTED_FILE_SUFFIX}`;
}

function parseKeyFile(content) {
  if (content.length === MASTER_KEY_BYTES) {
    return Buffer.from(content);
  }
  const text = content.toString('utf8').trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== KEY_MAGIC || !lines[1]) {
    throw new Error('Invalid encryption key file');
  }
  const key = Buffer.from(lines[1], 'base64');
  assertMasterKey(key);
  return key;
}

function assertMasterKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== MASTER_KEY_BYTES) {
    throw new Error('Encryption master key must be 32 bytes');
  }
}

function deriveFileKey(masterKey, fileSalt) {
  return Buffer.from(hkdfSync('sha256', masterKey, fileSalt, 'pcloud-nas-sync-file-v1', MASTER_KEY_BYTES));
}

function uint32(value) {
  const buffer = Buffer.alloc(HEADER_LENGTH_BYTES);
  buffer.writeUInt32BE(Number(value || 0));
  return buffer;
}

async function readEnvelopeHeader(filePath) {
  const prefix = await readFileSlice(filePath, 0, MAGIC.length + HEADER_LENGTH_BYTES);
  if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Unsupported encrypted file format');
  }
  const headerLength = prefix.readUInt32BE(MAGIC.length);
  const headerBytes = await readFileSlice(filePath, MAGIC.length + HEADER_LENGTH_BYTES, headerLength);
  const header = JSON.parse(headerBytes.toString('utf8'));
  if (header.v !== 1 || header.alg !== 'AES-256-GCM' || header.kdf !== 'HKDF-SHA256') {
    throw new Error('Unsupported encrypted file header');
  }
  return {
    header,
    ciphertextStart: MAGIC.length + HEADER_LENGTH_BYTES + headerLength
  };
}

async function readFileSlice(filePath, start, length) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    if (bytesRead !== length) {
      throw new Error('Encrypted file is truncated');
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

function hashTransform(hash) {
  return new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    const done = () => {
      stream.off('error', reject);
      resolve();
    };
    if (stream.write(chunk)) {
      done();
      return;
    }
    stream.once('drain', done);
  });
}

function endWithChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(chunk, () => {
      stream.off('error', reject);
      resolve();
    });
  });
}

async function sha1File(filePath) {
  const hash = createHash('sha1');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}
