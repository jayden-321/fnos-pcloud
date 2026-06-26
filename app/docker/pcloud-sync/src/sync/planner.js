const MTIME_TOLERANCE_MS = 2000;

export function planUploads(discovered, knownFiles, options = {}) {
  const known = knownFiles instanceof Map ? knownFiles : new Map();
  const remote = options.remoteFiles instanceof Map ? options.remoteFiles : null;
  const seen = new Set();
  const pending = [];
  const unchanged = [];

  for (const file of discovered) {
    seen.add(file.key);
    const existing = known.get(file.key);
    if (remote) {
      const remoteFile = remote.get(file.relativePath);
      if (remoteFile && sameRemoteFile(file, remoteFile)) {
        unchanged.push({ ...file, remote: remoteFile });
      } else {
        pending.push(file);
      }
    } else if (!existing || changed(file, existing) || needsRetry(existing)) {
      pending.push(file);
    } else {
      unchanged.push(file);
    }
  }

  const missingLocal = [];
  for (const [key, file] of known.entries()) {
    if (!seen.has(key)) {
      missingLocal.push(file);
    }
  }

  return { pending, unchanged, missingLocal };
}

function changed(next, previous) {
  return Number(next.size) !== Number(previous.size)
    || Number(next.mtimeMs) !== Number(previous.mtimeMs)
    || String(next.remotePath || '') !== String(previous.remotePath || '');
}

function needsRetry(file) {
  return ['failed', 'pending', 'uploading'].includes(file.status);
}

function sameRemoteFile(local, remote) {
  if (Number(local.size) !== Number(remote.size)) {
    return false;
  }
  const localMtime = Number(local.mtimeMs || 0);
  const remoteMtime = Number(remote.mtimeMs || 0);
  if (!Number.isFinite(localMtime) || !Number.isFinite(remoteMtime) || remoteMtime <= 0) {
    return true;
  }
  return Math.abs(localMtime - remoteMtime) <= MTIME_TOLERANCE_MS;
}
