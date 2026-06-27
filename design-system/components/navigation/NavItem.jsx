import React from 'react';

/**
 * NavItem — a left-rail navigation button. Active = solid accent fill on white
 * text; idle = transparent with a soft-blue hover.
 */
export function NavItem({ children, active = false, style = {}, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: '100%',
        minHeight: 40,
        border: 0,
        borderRadius: 'var(--radius-sm, 6px)',
        padding: '0 14px',
        fontSize: 16,
        fontWeight: 'var(--fw-bold, 700)',
        cursor: 'pointer',
        textAlign: 'left',
        background: active ? 'var(--accent)' : hover ? 'var(--nav-hover)' : 'transparent',
        color: active ? '#fff' : 'var(--text)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
