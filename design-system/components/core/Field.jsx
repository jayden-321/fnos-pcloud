import React from 'react';

/**
 * Field — label-over-control form group, the product's only form pattern.
 * Renders a 650-weight label, the control, and an optional muted field note.
 */
export function Field({ label, note, children, inline = false, style = {} }) {
  if (inline) {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, color: 'var(--text-soft)', fontWeight: 650, ...style }}>
        {children}
        {label}
      </label>
    );
  }
  return (
    <label style={{ display: 'grid', gap: 6, margin: '0 0 13px', color: 'var(--text-soft)', fontWeight: 650, ...style }}>
      {label}
      {children}
      {note && <small style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 500 }}>{note}</small>}
    </label>
  );
}

const controlStyle = {
  width: '100%',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm, 6px)',
  padding: '9px 10px',
  color: 'var(--text)',
  background: '#fff',
  font: 'inherit',
};

export function Input(props) {
  return <input {...props} style={{ ...controlStyle, ...(props.style || {}) }} />;
}

export function Select({ children, ...props }) {
  return <select {...props} style={{ ...controlStyle, ...(props.style || {}) }}>{children}</select>;
}

export function Textarea(props) {
  return <textarea {...props} style={{ ...controlStyle, resize: 'vertical', ...(props.style || {}) }} />;
}
