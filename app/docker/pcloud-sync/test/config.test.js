import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, redactConfig } from '../src/config/config.js';

test('normalizeConfig supplies safe defaults for first run', () => {
  const config = normalizeConfig({});

  assert.equal(config.port, 8080);
  assert.equal(config.sync.intervalSeconds, 300);
  assert.equal(config.sync.concurrency, 2);
  assert.equal(config.sync.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  assert.equal(config.sync.logRetentionDays, 30);
  assert.equal(config.sync.logRetentionCount, 300);
  assert.equal(config.sync.encryption.enabled, false);
  assert.equal(config.pcloud.hostname, 'api.pcloud.com');
  assert.equal(config.pcloud.remoteRoot, '/');
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
    sync: { intervalSeconds: 10, concurrency: 9, logRetentionDays: -1, logRetentionCount: 20000, ignorePatterns: '  *.tmp\\n.DS_Store\\n' }
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
  assert.equal(config.sync.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  assert.equal(config.sync.logRetentionDays, 0);
  assert.equal(config.sync.logRetentionCount, 10000);
  assert.deepEqual(config.sync.ignorePatterns, ['*.tmp', '.DS_Store']);
});

test('normalizeConfig keeps official upload conflict and checksum options', () => {
  const config = normalizeConfig({
    sync: {
      renameIfExists: true,
      checksumMode: 'sample',
      checksumSamplePercent: 25,
      mtimeVerifyConcurrency: 7,
      encryption: { enabled: true }
    }
  });

  assert.equal(config.sync.renameIfExists, true);
  assert.equal(config.sync.checksumMode, 'sample');
  assert.equal(config.sync.checksumSamplePercent, 25);
  assert.equal(config.sync.mtimeVerifyConcurrency, 7);
  assert.equal(config.sync.encryption.enabled, true);

  const fallback = normalizeConfig({
    sync: {
      renameIfExists: false,
      checksumMode: 'invalid',
      checksumSamplePercent: 500,
      mtimeVerifyConcurrency: 99
    }
  });

  assert.equal(fallback.sync.renameIfExists, false);
  assert.equal(fallback.sync.checksumMode, 'failed');
  assert.equal(fallback.sync.checksumSamplePercent, 100);
  assert.equal(fallback.sync.mtimeVerifyConcurrency, 10);
  assert.equal(fallback.sync.encryption.enabled, false);
});

test('normalizeConfig validates scheduler timezones', () => {
  const config = normalizeConfig({ sync: { timezone: 'Asia/Shanghai' } });
  const fallback = normalizeConfig({ sync: { timezone: 'Not/A_Zone' } });

  assert.equal(config.sync.timezone, 'Asia/Shanghai');
  assert.equal(fallback.sync.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
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
      remotePath: '/财务',
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
      remotePath: '/财务',
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

test('normalizeConfig accepts task-level schedules', () => {
  const config = normalizeConfig({
    tasks: [
      {
        id: 'daily',
        name: 'Daily',
        localPath: '/vol1/daily',
        remotePath: '/Sync/daily',
        schedule: { type: 'daily', time: '02:30' }
      },
      {
        id: 'weekly',
        name: 'Weekly',
        localPath: '/vol1/weekly',
        remotePath: '/Sync/weekly',
        schedule: { type: 'weekly', time: '23:45', weekdays: [1, 5, 9, 'bad'] }
      },
      {
        id: 'manual',
        name: 'Manual',
        localPath: '/vol1/manual',
        remotePath: '/Sync/manual',
        schedule: { type: 'manual' }
      }
    ]
  });

  assert.deepEqual(config.tasks.map((task) => task.schedule), [
    { type: 'daily', time: '02:30' },
    { type: 'weekly', time: '23:45', weekdays: [1, 5] },
    { type: 'manual' }
  ]);
});

test('normalizeConfig treats an explicit empty task list as deleted tasks', () => {
  const config = normalizeConfig({
    pcloud: { remoteRoot: '/NAS' },
    tasks: [],
    sources: [{ id: 'docs', path: '/vol1/docs', enabled: true, remoteName: 'docs' }]
  });

  assert.deepEqual(config.tasks, []);
  assert.deepEqual(config.sources, []);
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
