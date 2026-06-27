import React from 'react';

/**
 * StatusPill — colored status text used in logs, queue rows and task cards.
 * It is weight-700 colored text (not a filled badge) per the product style.
 */
const STATUS = {
  success: { color: 'var(--green)', label: '成功' },
  failed: { color: 'var(--danger)', label: '失败' },
  uploading: { color: 'var(--accent)', label: '上传中' },
  queued: { color: 'var(--queued)', label: '待处理' },
  existing: { color: 'var(--muted)', label: '已存在' },
};

export function StatusPill({ status = 'queued', children, style = {} }) {
  const s = STATUS[status] || STATUS.queued;
  return (
    <span style={{ fontWeight: 700, color: s.color, ...style }}>
      {children ?? s.label}
    </span>
  );
}
