import { createHash } from 'node:crypto';

export function resticTaskKey(value) {
  const raw = String(value || '').trim();
  const slug = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug && slug === raw) return slug;
  const digest = createHash('sha256').update(raw || 'restic-task').digest('hex').slice(0, 12);
  return `${slug || 'restic-task'}-${digest}`;
}
