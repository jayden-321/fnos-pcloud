import React from 'react';

export interface StatusPillProps {
  /** Sync status. @default "queued" */
  status?: 'success' | 'failed' | 'uploading' | 'queued' | 'existing';
  /** Override the default label text. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Colored weight-700 status text used in logs, queue rows and task cards. */
export function StatusPill(props: StatusPillProps): JSX.Element;
