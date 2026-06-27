import React from 'react';

export interface MetricCardProps {
  /** The large number/value. */
  value: React.ReactNode;
  /** Small caption beneath the value. */
  label: React.ReactNode;
  /** Color of the value. @default "default" */
  tone?: 'default' | 'success' | 'danger' | 'accent' | 'muted';
  style?: React.CSSProperties;
}

/**
 * Dashboard statistic tile — big number over a small label.
 *
 * @startingPoint section="Core" subtitle="Dashboard metric tiles" viewport="700x150"
 */
export function MetricCard(props: MetricCardProps): JSX.Element;
