import React from 'react';
import { StatusPill } from '../core/StatusPill.jsx';
import { Button } from '../core/Button.jsx';

/**
 * TaskCard — a single sync-task row on the Sync Tasks page. Shows the task
 * name, a colored status line, optional scan-source detail, an inline stat
 * grid, and right-aligned actions.
 */
export function TaskCard({
  name,
  status = 'queued',
  statusLabel,
  scanMode,
  scanDetail,
  stats = {},
  actions,
}) {
  const items = [
    ['Total', stats.total],
    ['Existing', stats.existing],
    ['Uploaded', stats.synced],
    ['Pending upload', stats.pending],
    ['Failed', stats.failed],
  ].filter(([, v]) => v !== undefined && v !== null);

  return (
    <article
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md, 8px)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          padding: '22px 28px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{name}</h3>
          <p style={{ margin: '4px 0 0' }}>
            <StatusPill status={status}>{statusLabel}</StatusPill>
          </p>
          {scanMode && (
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>Scan source：{scanMode}</p>
          )}
          {scanDetail && (
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>{scanDetail}</p>
          )}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '8px 14px',
              marginTop: 10,
              color: 'var(--muted)',
              fontSize: 13,
            }}
          >
            {items.map(([label, value]) => (
              <span key={label}>{label} {value}</span>
            ))}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {actions ?? (
            <>
              <Button variant="soft">View Logs</Button>
              <Button variant="soft">Edit</Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
