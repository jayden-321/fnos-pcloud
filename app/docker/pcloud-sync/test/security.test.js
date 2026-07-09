import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('fnOS iframe launch port is reachable from the LAN by default', async () => {
  const compose = await readFile(new URL('../../docker-compose.yaml', import.meta.url), 'utf8');
  const uiConfig = JSON.parse(await readFile(new URL('../../../ui/config', import.meta.url), 'utf8'));
  const launchConfig = uiConfig['.url']['pcloud-nas-sync.APPLICATION'];

  assert.equal(launchConfig.type, 'iframe');
  assert.equal(launchConfig.protocol, 'http');
  assert.equal(launchConfig.port, '17880');
  assert.match(compose, /\$\{TRIM_SERVICE_BIND:-0\.0\.0\.0\}:\$\{TRIM_SERVICE_PORT:-17880\}:8080/);
  assert.doesNotMatch(compose, /\$\{TRIM_SERVICE_BIND:-127\.0\.0\.1\}:\$\{TRIM_SERVICE_PORT:-17880\}:8080/);
});

test('root dockerignore excludes SQLite runtime state', async () => {
  const dockerignore = await readFile(new URL('../../../../.dockerignore', import.meta.url), 'utf8');

  assert.match(dockerignore, /^state\.sqlite$/m);
  assert.match(dockerignore, /^state\.sqlite-\*$/m);
});
