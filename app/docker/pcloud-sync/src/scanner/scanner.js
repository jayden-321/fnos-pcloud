import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export async function scanSource(source, ignorePatterns = []) {
  const root = path.resolve(source.localPath ?? source.path);
  const files = [];
  await walk(root, '', source, ignorePatterns, files);
  return files.sort((a, b) => a.key.localeCompare(b.key));
}

async function walk(root, relativeDir, source, ignorePatterns, files) {
  const currentDir = path.join(root, relativeDir);
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (isIgnored(relativePath, entry.name, ignorePatterns)) {
      continue;
    }

    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      await walk(root, relativePath, source, ignorePatterns, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const info = await stat(absolutePath);
    files.push({
      key: `${source.id}/${relativePath}`,
      sourceId: source.id,
      absolutePath,
      relativePath,
      remotePath: joinRemote(source.remotePath || `/${source.remoteName}`, relativePath),
      size: info.size,
      mtimeMs: Math.trunc(info.mtimeMs),
      mtime: Math.trunc(info.mtimeMs / 1000)
    });
  }
}

export function isIgnored(relativePath, basename, patterns = []) {
  return patterns.some((pattern) => matchPattern(relativePath, basename, pattern));
}

function matchPattern(relativePath, basename, pattern) {
  const value = String(pattern || '').trim();
  if (!value) {
    return false;
  }
  if (value === basename || value === relativePath) {
    return true;
  }
  if (value.startsWith('*.')) {
    return basename.endsWith(value.slice(1));
  }
  if (value.endsWith('*')) {
    return relativePath.startsWith(value.slice(0, -1)) || basename.startsWith(value.slice(0, -1));
  }
  if (value.startsWith('*')) {
    return relativePath.endsWith(value.slice(1)) || basename.endsWith(value.slice(1));
  }
  return false;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function joinRemote(...parts) {
  const joined = parts
    .join('/')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .join('/');
  return `/${joined}`;
}
