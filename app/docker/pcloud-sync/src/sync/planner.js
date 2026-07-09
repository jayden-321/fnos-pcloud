const MTIME_TOLERANCE_MS = 2000;

export function planUploads(discovered, knownFiles, options = {}) {
  const known = knownFiles instanceof Map ? knownFiles : new Map();
  const remote = options.remoteFiles instanceof Map ? options.remoteFiles : null;
  const encryptionEnabled = options.encryptionEnabled === true;
  const seen = new Set();
  const pending = [];
  const unchanged = [];

  for (const file of discovered) {
    seen.add(file.key);
    const existing = known.get(file.key);
    if (remote) {
      const remoteFile = remote.get(remoteRelativePathForFile(file, existing, encryptionEnabled));
      if (remoteFile && sameRemoteFile(file, remoteFile, existing, encryptionEnabled)) {
        unchanged.push({ ...file, remote: remoteFile });
      } else {
        pending.push(file);
      }
    } else if (!existing || changed(file, existing, encryptionEnabled) || needsRetry(existing)) {
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

function changed(next, previous, encryptionEnabled = false) {
  if (encryptionEnabled && previous.encryption?.enabled !== true) {
    return true;
  }
  const nextRemotePath = encryptionEnabled ? encryptedPath(next.remotePath) : String(next.remotePath || '');
  const previousRemotePath = String(previous.remotePath || previous.pcloudPath || '');
  return Number(next.size) !== Number(previous.size)
    || Number(next.mtimeMs) !== Number(previous.mtimeMs)
    || nextRemotePath !== previousRemotePath;
}

function needsRetry(file) {
  return ['failed', 'pending', 'uploading'].includes(file.status);
}

function sameRemoteFile(local, remote, previous = null, encryptionEnabled = false) {
  if (encryptionEnabled) {
    return sameEncryptedRemoteFile(local, remote, previous);
  }
  if (Number(local.size) !== Number(remote.size)) {
    return false;
  }
  const localMtime = Number(local.mtimeMs || 0);
  const remoteMtime = Number(remote.mtimeMs || 0);
  if (!Number.isFinite(localMtime) || !Number.isFinite(remoteMtime) || remoteMtime <= 0) {
    return true;
  }
  if (Math.abs(localMtime - remoteMtime) <= MTIME_TOLERANCE_MS) {
    return true;
  }
  if (!previous) {
    return true;
  }
  const previousMtime = Number(previous.mtimeMs || 0);
  if (!Number.isFinite(previousMtime) || previousMtime <= 0) {
    return true;
  }
  return Math.abs(localMtime - previousMtime) <= MTIME_TOLERANCE_MS;
}

function remoteRelativePathForFile(file, previous, encryptionEnabled) {
  if (!encryptionEnabled) {
    return file.relativePath;
  }
  return previous?.encryption?.remoteRelativePath || encryptedRelativePath(file.relativePath);
}

function sameEncryptedRemoteFile(local, remote, previous = null) {
  if (previous?.encryption?.enabled !== true) {
    return false;
  }
  if (Number(local.size) !== Number(previous.size)) {
    return false;
  }
  if (Number(local.mtimeMs) !== Number(previous.mtimeMs)) {
    return false;
  }
  const ciphertextSize = Number(previous.encryption.ciphertextSize || 0);
  return ciphertextSize > 0 && Number(remote.size || 0) === ciphertextSize;
}

function encryptedRelativePath(relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/');
  return normalized.endsWith('.pcenc') ? normalized : `${normalized}.pcenc`;
}

function encryptedPath(remotePath) {
  const normalized = String(remotePath || '');
  return normalized.endsWith('.pcenc') ? normalized : `${normalized}.pcenc`;
}
