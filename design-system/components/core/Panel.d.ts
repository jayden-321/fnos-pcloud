import React from 'react';

export interface PanelProps extends React.HTMLAttributes<HTMLElement> {
  /** Optional heading rendered at the top of the panel. */
  title?: React.ReactNode;
  /** Optional control aligned to the right of the title row. */
  action?: React.ReactNode;
  /** Inner padding in px. @default 18 */
  padding?: number;
  children?: React.ReactNode;
}

/** White bordered section container — the product's primary content surface. */
export function Panel(props: PanelProps): JSX.Element;
