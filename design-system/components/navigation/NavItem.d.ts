import React from 'react';

export interface NavItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Whether this item is the current page. @default false */
  active?: boolean;
  children?: React.ReactNode;
}

/** Left-rail navigation button (active = solid accent fill). */
export function NavItem(props: NavItemProps): JSX.Element;
