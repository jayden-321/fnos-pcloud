import React from 'react';

/**
 * Panel — the white bordered container that wraps every section in the product
 * (queue table, settings groups, dialogs). Flat: fill + 1px line, no shadow.
 */
export function Panel({ title, action, children, padding = 18, style = {}, ...rest }) {
  return (
    <section
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md, 8px)',
        padding,
        ...style,
      }}
      {...rest}
    >
      {(title || action) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: action ? 'space-between' : 'flex-start',
            marginBottom: 16,
          }}
        >
          {title && (
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 'var(--fw-bold,700)', color: 'var(--text)' }}>
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
