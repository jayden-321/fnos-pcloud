import React from 'react';

/**
 * Button — the product's action control. Primary is solid accent-blue; "soft"
 * is the pale-blue secondary used on cards, dialogs and task editors; "ghost"
 * is the transparent sidebar/link style.
 */
export function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled = false,
  fullWidth = false,
  style = {},
  ...rest
}) {
  const base = {
    minHeight: 'var(--control-h, 36px)',
    border: 0,
    borderRadius: 'var(--radius-sm, 6px)',
    padding: '0 var(--btn-pad-x, 14px)',
    font: 'inherit',
    fontWeight: 'var(--fw-bold, 700)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.48 : 1,
    width: fullWidth ? '100%' : undefined,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'background 120ms ease',
  };
  const variants = {
    primary: { background: 'var(--accent)', color: '#fff' },
    soft: { background: 'var(--accent-soft)', color: 'var(--accent-ink)' },
    ghost: { background: 'transparent', color: 'var(--text)' },
    link: { background: 'transparent', color: 'var(--create-ink)' },
  };
  const [hover, setHover] = React.useState(false);
  const hoverBg = {
    primary: 'var(--accent-strong)',
    soft: 'var(--accent-soft-hover)',
    ghost: 'var(--nav-hover)',
    link: 'var(--nav-hover)',
  };
  const merged = {
    ...base,
    ...variants[variant],
    ...(hover && !disabled ? { background: hoverBg[variant] } : null),
    ...style,
  };
  return (
    <button
      type={type}
      disabled={disabled}
      style={merged}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
    >
      {children}
    </button>
  );
}
