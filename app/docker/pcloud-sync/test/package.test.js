import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Dockerfile uses a domestic explicit base image by default', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');

  assert.doesNotMatch(dockerfile, /^FROM\s+node:/m);
  assert.match(dockerfile, /^ARG\s+NODE_BASE_IMAGE=docker\.m\.daocloud\.io\/library\/node:22-alpine/m);
  assert.match(dockerfile, /^FROM\s+\$\{NODE_BASE_IMAGE\}/m);
});
