import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('docker port publishing defaults to host loopback only', async () => {
  const compose = await readFile(new URL('../../docker-compose.yaml', import.meta.url), 'utf8');

  assert.match(compose, /\$\{TRIM_SERVICE_BIND:-127\.0\.0\.1\}:\$\{TRIM_SERVICE_PORT:-17880\}:8080/);
  assert.doesNotMatch(compose, /-\s*"\$\{TRIM_SERVICE_PORT:-17880\}:8080"/);
});
