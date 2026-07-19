import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { once } from 'node:events';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const STORE_METHOD = 0;
const VERSION_NEEDED = 20;
const UTF8_FILENAME_FLAG = 0x0800;
const UINT32_MAX = 0xffffffff;

let crcTable = null;

export async function writeStoredZip({ entries, targetPath }) {
  const out = createWriteStream(targetPath, { mode: 0o600 });
  const centralRecords = [];
  let offset = 0;
  try {
    for (const entry of entries) {
      const name = normalizeZipPath(entry.archivePath);
      const nameBytes = Buffer.from(name, 'utf8');
      const info = await fileInfo(entry.sourcePath);
      assertZip32(info.size, 'ZIP entry is too large');
      assertZip32(offset, 'ZIP archive is too large');

      const localHeader = localFileHeader({ nameBytes, info });
      await writeChunk(out, localHeader);
      offset += localHeader.length;
      await copyFileToStream(entry.sourcePath, out);
      offset += info.size;

      centralRecords.push({
        nameBytes,
        info,
        offset: offset - info.size - localHeader.length
      });
    }

    const centralOffset = offset;
    for (const record of centralRecords) {
      const centralHeader = centralDirectoryHeader(record);
      await writeChunk(out, centralHeader);
      offset += centralHeader.length;
    }
    const centralSize = offset - centralOffset;
    const end = endOfCentralDirectory({
      entryCount: centralRecords.length,
      centralSize,
      centralOffset
    });
    await writeChunk(out, end);
    await endStream(out);
  } catch (error) {
    out.destroy();
    throw error;
  }
}

function localFileHeader({ nameBytes, info }) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(UTF8_FILENAME_FLAG, 6);
  header.writeUInt16LE(STORE_METHOD, 8);
  header.writeUInt16LE(info.dosTime, 10);
  header.writeUInt16LE(info.dosDate, 12);
  header.writeUInt32LE(info.crc32, 14);
  header.writeUInt32LE(info.size, 18);
  header.writeUInt32LE(info.size, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes]);
}

function centralDirectoryHeader({ nameBytes, info, offset }) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(UTF8_FILENAME_FLAG, 8);
  header.writeUInt16LE(STORE_METHOD, 10);
  header.writeUInt16LE(info.dosTime, 12);
  header.writeUInt16LE(info.dosDate, 14);
  header.writeUInt32LE(info.crc32, 16);
  header.writeUInt32LE(info.size, 20);
  header.writeUInt32LE(info.size, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBytes]);
}

function endOfCentralDirectory({ entryCount, centralSize, centralOffset }) {
  assertZip16(entryCount, 'ZIP archive has too many files');
  assertZip32(centralSize, 'ZIP central directory is too large');
  assertZip32(centralOffset, 'ZIP archive is too large');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

async function fileInfo(filePath) {
  const info = await stat(filePath);
  return {
    size: Number(info.size || 0),
    crc32: await crc32File(filePath),
    ...dosDateTime(info.mtime)
  };
}

async function crc32File(filePath) {
  let crc = 0xffffffff;
  for await (const chunk of createReadStream(filePath)) {
    for (const byte of chunk) {
      crc = crcTableForByte()[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function crcTableForByte() {
  if (crcTable) {
    return crcTable;
  }
  crcTable = new Uint32Array(256);
  for (let byte = 0; byte < 256; byte += 1) {
    let value = byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[byte] = value >>> 0;
  }
  return crcTable;
}

async function copyFileToStream(filePath, out) {
  for await (const chunk of createReadStream(filePath)) {
    await writeChunk(out, chunk);
  }
}

function dosDateTime(date) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const year = Math.max(1980, value.getFullYear());
  return {
    dosDate: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
    dosTime: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2)
  };
}

function normalizeZipPath(value) {
  const parts = String(value || 'download')
    .replaceAll('\\', '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..');
  const name = parts.join('/');
  if (!name) {
    throw new Error('ZIP entry path is required');
  }
  return name;
}

async function writeChunk(out, chunk) {
  if (!out.write(chunk)) {
    await once(out, 'drain');
  }
}

async function endStream(out) {
  out.end();
  await once(out, 'finish');
}

function assertZip16(value, message) {
  if (value > 0xffff) {
    throw new Error(message);
  }
}

function assertZip32(value, message) {
  if (value > UINT32_MAX) {
    throw new Error(message);
  }
}
