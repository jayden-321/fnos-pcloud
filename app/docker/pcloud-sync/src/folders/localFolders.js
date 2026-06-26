import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ROOTS = ['/vol1', '/vol2', '/vol3', '/vol4', '/vol5', '/vol6', '/vol7', '/vol8', '/vol9'];

export async function listLocalFolders(requestedPath = '', roots = DEFAULT_ROOTS) {
  const allowedRoots = normalizeRoots(roots);
  if (allowedRoots.length === 0) {
    return { path: '/', parent: null, entries: [] };
  }

  if (!requestedPath) {
    return {
      path: '/',
      parent: null,
      entries: await existingRootEntries(allowedRoots)
    };
  }

  const current = path.resolve(String(requestedPath));
  if (!isInsideRoots(current, allowedRoots)) {
    const error = new Error('Local folder is outside allowed roots');
    error.statusCode = 403;
    throw error;
  }

  const info = await stat(current);
  if (!info.isDirectory()) {
    throw new Error('Local path is not a directory');
  }

  const entries = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    entries.push({
      name: entry.name,
      path: path.join(current, entry.name)
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: current,
    parent: parentPath(current, allowedRoots),
    entries
  };
}

export function defaultLocalRoots(extraRoots = []) {
  const envRoots = String(process.env.LOCAL_FOLDER_ROOTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return normalizeRoots([...envRoots, ...extraRoots, ...DEFAULT_ROOTS]);
}

function normalizeRoots(roots) {
  return [...new Set((roots || [])
    .map((root) => String(root || '').trim())
    .filter(Boolean)
    .map((root) => path.resolve(root)))];
}

async function existingRootEntries(roots) {
  const entries = [];
  for (const root of roots) {
    try {
      const info = await stat(root);
      if (info.isDirectory()) {
        entries.push({ name: root, path: root });
      }
    } catch {
      // Ignore unavailable volumes.
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function isInsideRoots(current, roots) {
  return roots.some((root) => current === root || current.startsWith(`${root}${path.sep}`));
}

function parentPath(current, roots) {
  if (roots.includes(current)) {
    return '/';
  }
  const parent = path.dirname(current);
  return isInsideRoots(parent, roots) ? parent : '/';
}
