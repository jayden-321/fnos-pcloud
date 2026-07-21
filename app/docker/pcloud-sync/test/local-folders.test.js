import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultLocalRoots } from '../src/folders/localFolders.js';

test('managed folder roots do not fall back to complete NAS volumes', () => {
  const previous = process.env.LOCAL_FOLDER_ROOTS;
  process.env.LOCAL_FOLDER_ROOTS = '/sources/one,/sources/two';
  try {
    assert.deepEqual(defaultLocalRoots(), ['/sources/one', '/sources/two']);
    assert.equal(defaultLocalRoots().some((root) => root.startsWith('/vol')), false);
  } finally {
    if (previous === undefined) delete process.env.LOCAL_FOLDER_ROOTS;
    else process.env.LOCAL_FOLDER_ROOTS = previous;
  }
});
