import React from 'react';

export interface TaskStats {
  total?: number;
  existing?: number;
  synced?: number;
  pending?: number;
  failed?: number;
}

export interface TaskCardProps {
  /** Task name (heading). */
  name: React.ReactNode;
  /** Sync status driving the status-line color. @default "queued" */
  status?: 'success' | 'failed' | 'uploading' | 'queued' | 'existing';
  /** Override the status label text (e.g. "Sync complete"). */
  statusLabel?: React.ReactNode;
  /** Scan-source descriptor, e.g. "Full remote comparison". */
  scanMode?: React.ReactNode;
  /** Secondary scan detail line, e.g. "Local 1,284 · Remote 1,266". */
  scanDetail?: React.ReactNode;
  /** Inline counts shown in the stat grid. */
  stats?: TaskStats;
  /** Custom action buttons; defaults to View Logs / Edit. */
  actions?: React.ReactNode;
}

/**
 * A sync-task row on the Sync Tasks page.
 *
 * @startingPoint section="Tasks" subtitle="Sync-task card with status & stats" viewport="760x190"
 */
export function TaskCard(props: TaskCardProps): JSX.Element;
