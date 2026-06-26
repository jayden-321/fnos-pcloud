import test from 'node:test';
import assert from 'node:assert/strict';
import { planUploads } from '../src/sync/planner.js';

test('planUploads marks new and changed files pending without deleting missing cloud files', () => {
  const discovered = [
    { key: 'src/a.txt', size: 5, mtimeMs: 1000 },
    { key: 'src/b.txt', size: 9, mtimeMs: 2000 }
  ];
  const known = new Map([
    ['src/a.txt', { key: 'src/a.txt', size: 5, mtimeMs: 1000, status: 'synced' }],
    ['src/old.txt', { key: 'src/old.txt', size: 1, mtimeMs: 1, status: 'synced' }]
  ]);

  const plan = planUploads(discovered, known);

  assert.deepEqual(plan.pending.map((item) => item.key), ['src/b.txt']);
  assert.deepEqual(plan.unchanged.map((item) => item.key), ['src/a.txt']);
  assert.deepEqual(plan.missingLocal.map((item) => item.key), ['src/old.txt']);
});

test('planUploads retries files when their remote path changed', () => {
  const discovered = [
    { key: '--/a.txt', size: 5, mtimeMs: 1000, remotePath: '/财务/a.txt' }
  ];
  const known = new Map([
    ['--/a.txt', { key: '--/a.txt', size: 5, mtimeMs: 1000, remotePath: '/--/a.txt', status: 'synced' }]
  ]);

  const plan = planUploads(discovered, known);

  assert.deepEqual(plan.pending.map((item) => item.key), ['--/a.txt']);
  assert.deepEqual(plan.unchanged, []);
});

test('planUploads skips files that already match remote size and mtime', () => {
  const discovered = [
    { key: '财务/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 2000 }
  ];
  const remote = new Map([
    ['a.txt', { relativePath: 'a.txt', size: 5, mtimeMs: 2000 }]
  ]);

  const plan = planUploads(discovered, new Map(), { remoteFiles: remote });

  assert.deepEqual(plan.pending, []);
  assert.deepEqual(plan.unchanged.map((item) => item.key), ['财务/a.txt']);
});

test('planUploads uploads files that are missing from remote', () => {
  const discovered = [
    { key: '财务/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 2000 }
  ];

  const plan = planUploads(discovered, new Map(), { remoteFiles: new Map() });

  assert.deepEqual(plan.pending.map((item) => item.key), ['财务/a.txt']);
  assert.deepEqual(plan.unchanged, []);
});

test('planUploads uploads files when remote size differs', () => {
  const discovered = [
    { key: '财务/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 2000 },
    { key: '财务/b.txt', relativePath: 'b.txt', size: 9, mtimeMs: 4000 }
  ];
  const remote = new Map([
    ['a.txt', { relativePath: 'a.txt', size: 4, mtimeMs: 2000 }],
    ['b.txt', { relativePath: 'b.txt', size: 9, mtimeMs: 1000 }]
  ]);

  const plan = planUploads(discovered, new Map(), { remoteFiles: remote });

  assert.deepEqual(plan.pending.map((item) => item.key), ['财务/a.txt']);
  assert.deepEqual(plan.unchanged.map((item) => item.key), ['财务/b.txt']);
});

test('planUploads adopts existing remote files by same path and size on first scan', () => {
  const discovered = [
    { key: '财务/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 2000 }
  ];
  const remote = new Map([
    ['a.txt', { relativePath: 'a.txt', size: 5, mtimeMs: 1000 }]
  ]);

  const plan = planUploads(discovered, new Map(), { remoteFiles: remote });

  assert.deepEqual(plan.pending, []);
  assert.deepEqual(plan.unchanged.map((item) => item.key), ['财务/a.txt']);
});

test('planUploads uploads same-size files when local mtime changed after an accepted remote match', () => {
  const discovered = [
    { key: '财务/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 7000 }
  ];
  const known = new Map([
    ['财务/a.txt', { key: '财务/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 2000, status: 'existing' }]
  ]);
  const remote = new Map([
    ['a.txt', { relativePath: 'a.txt', size: 5, mtimeMs: 1000 }]
  ]);

  const plan = planUploads(discovered, known, { remoteFiles: remote });

  assert.deepEqual(plan.pending.map((item) => item.key), ['财务/a.txt']);
  assert.deepEqual(plan.unchanged, []);
});

test('planUploads ignores old local state when the new remote directory is missing files', () => {
  const discovered = [
    { key: '财务/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 2000 }
  ];
  const known = new Map([
    ['--/a.txt', { key: '--/a.txt', relativePath: 'a.txt', size: 5, mtimeMs: 2000, status: 'synced' }]
  ]);

  const plan = planUploads(discovered, known, { remoteFiles: new Map() });

  assert.deepEqual(plan.pending.map((item) => item.key), ['财务/a.txt']);
});
