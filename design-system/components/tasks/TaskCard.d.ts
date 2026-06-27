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
  /** Override the status label text (e.g. "同步完成"). */
  statusLabel?: React.ReactNode;
  /** Scan-source descriptor, e.g. "远端全量比对". */
  scanMode?: React.ReactNode;
  /** Secondary scan detail line, e.g. "本地 1,284 · 远端 1,266". */
  scanDetail?: React.ReactNode;
  /** Inline counts shown in the stat grid. */
  stats?: TaskStats;
  /** Custom action buttons; defaults to 查看日志 / 编辑. */
  actions?: React.ReactNode;
}

/**
 * A sync-task row on the Sync Tasks page.
 *
 * @startingPoint section="Tasks" subtitle="Sync-task card with status & stats" viewport="760x190"
 */
export function TaskCard(props: TaskCardProps): JSX.Element;
