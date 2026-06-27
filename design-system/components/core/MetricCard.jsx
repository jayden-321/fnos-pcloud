import React from 'react';

/**
 * MetricCard — a single dashboard statistic tile (大数字 + small label),
 * exactly as used in the sync-tasks metrics strip.
 */
export function MetricCard({ value, label, tone = 'default', style = {} }) {
  const tones = {
    default: 'var(--text)',
    success: 'var(--green)',
    danger: 'var(--danger)',
    accent: 'var(--accent)',
    muted: 'var(--queued)',
  };
  return (
    <div
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md, 8px)',
        padding: 16,
        ...style,
      }}
    >
      <span style={{ display: 'block', fontSize: 26, fontWeight: 760, lineHeight: 1.1, color: tones[tone] }}>
        {value}
      </span>
      <small style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</small>
    </div>
  );
}
