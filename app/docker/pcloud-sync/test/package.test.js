import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Dockerfile uses a domestic explicit base image by default', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');

  assert.doesNotMatch(dockerfile, /^FROM\s+node:/m);
  assert.match(dockerfile, /^ARG\s+NODE_BASE_IMAGE=docker\.m\.daocloud\.io\/library\/node:22-alpine/m);
  assert.match(dockerfile, /^FROM\s+\$\{NODE_BASE_IMAGE\}/m);
});

test('app startup does not trigger a full sync scan automatically', async () => {
  const entry = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');

  assert.doesNotMatch(entry, /setTimeout\(\(\)\s*=>\s*{\s*engine\.scanNow/s);
  assert.doesNotMatch(entry, /Initial scan failed/);
});

test('小皓OS manifest declares narrow storage permissions and health check', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../../../config/xiaohao-app.json', import.meta.url), 'utf8'));

  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.architectures, ['amd64']);
  assert.deepEqual(manifest.permissions.accessiblePaths, [{
    id: 'backup-sources',
    access: 'read-only',
    target: '/sources',
    multiple: true,
    description: '用户明确选择的备份源目录；应用不能修改或删除源文件。'
  }]);
  assert.equal(manifest.permissions.shares[0].target, '/restore');
  assert.equal(manifest.health.path, '/api/status');
});

test('package does not request root or expose complete NAS volumes', async () => {
  const privilege = await readFile(new URL('../../../../config/privilege', import.meta.url), 'utf8');
  const compose = await readFile(new URL('../../docker-compose.yaml', import.meta.url), 'utf8');

  assert.equal(JSON.parse(privilege).defaults['run-as'], 'package');
  assert.doesNotMatch(compose, /["']?\/vol\d+(?:\/|["']|:)/);
  assert.doesNotMatch(compose, /container_name:/);
  assert.match(compose, /LOCAL_FOLDER_ROOTS:\s*\/sources/);
  assert.match(compose, /:\/sources:ro/);
  assert.match(compose, /:\/restore/);
});
