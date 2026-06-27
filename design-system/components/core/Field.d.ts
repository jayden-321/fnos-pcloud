import React from 'react';

export interface FieldProps {
  /** Label text shown above (or beside, when inline) the control. */
  label: React.ReactNode;
  /** Muted helper note shown beneath the control. */
  note?: React.ReactNode;
  /** Inline checkbox/radio layout (label beside control). @default false */
  inline?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Label-over-control form group — the product's single form pattern. */
export function Field(props: FieldProps): JSX.Element;
/** Styled text input. */
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>): JSX.Element;
/** Styled select. */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>): JSX.Element;
/** Styled textarea. */
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element;
