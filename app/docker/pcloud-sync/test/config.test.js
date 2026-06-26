import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, redactConfig } from '../src/config/config.js';

test('normalizeConfig supplies safe defaults for first run', () => {
  const config = normalizeConfig({});

  assert.equal(config.port, 8080);
  assert.equal(config.sync.intervalSeconds, 300);
  assert.equal(config.sync.concurrency, 2);
  assert.equal(config.pcloud.hostname, 'api.pcloud.com');
  assert.equal(config.pcloud.remoteRoot, '/NAS-Backup');
  assert.deepEqual(config.tasks, []);
  assert.deepEqual(config.sources, []);
});

test('normalizeConfig rejects unsafe pCloud hostnames', () => {
  assert.throws(
    () => normalizeConfig({ pcloud: { hostname: 'evil.example.com' } }),
    /Unsupported pCloud API hostname/
  );
});

test('normalizeConfig accepts official regional pCloud API hostnames', () => {
  const config = normalizeConfig({ pcloud: { hostname: 'api-ams1.pcloud.com' } });

  assert.equal(config.pcloud.hostname, 'api-ams1.pcloud.com');
});

test('normalizeConfig cleans remote root and source definitions', () => {
  const config = normalizeConfig({
    pcloud: { remoteRoot: 'Backups//NAS/' },
    sources: [
      { id: 'photos', path: '/vol1/photos', enabled: true, remoteName: ' Photos ' },
      { path: '   ', enabled: true }
    ],
    sync: { intervalSeconds: 10, concurrency: 9, ignorePatterns: '  *.tmp\\n.DS_Store\\n' }
  });

  assert.equal(config.pcloud.remoteRoot, '/Backups/NAS');
  assert.deepEqual(config.tasks, [
    {
      id: 'photos',
      name: 'photos',
      enabled: true,
      localPath: '/vol1/photos',
      remotePath: '/Backups/NAS/Photos',
      mode: 'upload'
    }
  ]);
  assert.deepEqual(config.sources, [
    { id: 'photos', path: '/vol1/photos', enabled: true, remoteName: 'Photos' }
  ]);
  assert.equal(config.sync.intervalSeconds, 30);
  assert.equal(config.sync.concurrency, 8);
  assert.deepEqual(config.sync.ignorePatterns, ['*.tmp', '.DS_Store']);
});

test('normalizeConfig preserves non-ASCII source names for remote folders', () => {
  const config = normalizeConfig({
    sources: [
      { path: '/vol1/财务' }
    ]
  });

  assert.deepEqual(config.tasks, [
    {
      id: '财务',
      name: '财务',
      enabled: true,
      localPath: '/vol1/财务',
      remotePath: '/NAS-Backup/财务',
      mode: 'upload'
    }
  ]);
});

test('normalizeConfig migrates legacy dashed names generated from non-ASCII paths', () => {
  const config = normalizeConfig({
    sources: [
      { id: '--', path: '/vol1/财务', enabled: true, remoteName: '--' }
    ]
  });

  assert.deepEqual(config.tasks, [
    {
      id: '财务',
      name: '财务',
      enabled: true,
      localPath: '/vol1/财务',
      remotePath: '/NAS-Backup/财务',
      mode: 'upload'
    }
  ]);
});

test('normalizeConfig accepts explicit multi-task definitions', () => {
  const config = normalizeConfig({
    pcloud: { remoteRoot: '/NAS' },
    tasks: [
      {
        id: 'work',
        name: 'Work Files',
        localPath: '/vol1/work',
        remotePath: 'Company/Work',
        mode: 'upload',
        enabled: true
      },
      {
        name: 'Finance',
        localPath: '/vol1/财务',
        remotePath: '/NAS/财务',
        mode: 'download',
        enabled: false
      }
    ]
  });

  assert.deepEqual(config.tasks, [
    {
      id: 'work',
      name: 'Work Files',
      enabled: true,
      localPath: '/vol1/work',
      remotePath: '/Company/Work',
      mode: 'upload'
    },
    {
      id: 'Finance',
      name: 'Finance',
      enabled: false,
      localPath: '/vol1/财务',
      remotePath: '/NAS/财务',
      mode: 'upload'
    }
  ]);
});

test('redactConfig hides stored secrets but keeps connection shape', () => {
  const redacted = redactConfig(normalizeConfig({
    pcloud: {
      clientSecret: 'secret',
      accessToken: 'token',
      clientId: 'client'
    }
  }));

  assert.equal(redacted.pcloud.clientId, 'client');
  assert.equal(redacted.pcloud.clientSecret, '***');
  assert.equal(redacted.pcloud.accessToken, '***');
});
