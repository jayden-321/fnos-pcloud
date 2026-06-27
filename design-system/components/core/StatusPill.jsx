import React from 'react';

/**
 * StatusPill — colored status text used in logs, queue rows and task cards.
 * It is weight-700 colored text (not a filled badge) per the product style.
 */
const STATUS = {
  success: { color: 'var(--green)', label: 'Success' },
  failed: { color: 'var(--danger)', label: 'Failed' },
  uploading: { color: 'var(--accent)', label: 'Uploading' },
  queued: { color: 'var(--queued)', label: 'Queued' },
  existing: { color: 'var(--muted)', label: 'Existing' },
};

export function StatusPill({ status = 'queued', children, style = {} }) {
  const s = STATUS[status] || STATUS.queued;
  return (
    <span style={{ fontWeight: 700, color: s.color, ...style }}>
      {children ?? s.label}
    </span>
  );
}
