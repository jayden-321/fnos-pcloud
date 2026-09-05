import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

// A deleted bind mount still passes stat(), but has nlink=0. Node's native
// recursive mkdir can retry ENOENT forever under that mount. Never use it here.
export async function requireDirectory(directory) {
  const info = await stat(directory);
  if (!info.isDirectory() || info.nlink === 0) {
    const error = new Error(`目录不可用或挂载已失效：${directory}。请检查宿主机目录并重新挂载容器。`);
    error.code = 'ESTALE';
    throw error;
  }
  return info;
}

export async function ensureDirectory(directory, { mode = 0o755 } = {}) {
  const target = path.resolve(directory);
  try {
    await requireDirectory(target);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const parent = path.dirname(target);
  if (parent === target) throw new Error(`目录根不可用：${target}`);
  await ensureDirectory(parent, { mode });
  try {
    // One attempt only, including if the parent disappears after validation.
    await mkdir(target, { mode });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await requireDirectory(target);
}
