import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "primary" */
  variant?: 'primary' | 'soft' | 'ghost' | 'link';
  /** Stretch to fill the container width. @default false */
  fullWidth?: boolean;
  children?: React.ReactNode;
}

/**
 * Primary action control for pCloud NAS Sync.
 *
 * @startingPoint section="Core" subtitle="Primary, soft, ghost and link buttons" viewport="700x140"
 */
export function Button(props: ButtonProps): JSX.Element;
