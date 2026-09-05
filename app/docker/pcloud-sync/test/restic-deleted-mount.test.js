import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureDirectory } from '../src/restic/directories.js';
import { ResticService } from '../src/restic/service.js';

// Run only in a disposable Linux container after removing its empty bind source.
// Never remove an application/user directory to set up this test.
const deletedMount = process.env.RESTIC_TEST_DELETED_MOUNT;
test('deleted bind mount fails promptly and cannot block backup directory preparation', {
  skip: !deletedMount,
  timeout: 3000
}, async () => {
  assert.equal((await stat(deletedMount)).nlink, 0, 'fixture must be a deleted bind mount');
  const dataDir = await mkdtemp(path.join(tmpdir(), 'restic-mount-test-'));
  try {
    await assert.rejects(ensureDirectory(path.join(deletedMount, '.downloads')), { code: 'ESTALE' });
    const service = new ResticService({ dataDir, restoreRoot: deletedMount });
    await service.ensureDirectories();
    await assert.rejects(service.requireRestoreRoot(), /恢复目录不可用/);
    assert.equal(service.getStatus().active, false);
  } finally {
    await rm(dataDir, { recursive: true });
  }
});
