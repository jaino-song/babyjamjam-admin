"use client";

import { type ReactNode } from "react";
import { Label } from "./label";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  helperText?: string;
  htmlFor?: string;
  dataComponent?: string;
  children: ReactNode;
}

export function FormField({
  label,
  error,
  required = false,
  helperText,
  htmlFor,
  dataComponent,
  children,
}: FormFieldProps) {
  return (
    <div
      data-component={dataComponent ?? "field"}
      style={{ marginBottom: "var(--space-5)" }}
    >
      <Label
        htmlFor={htmlFor}
        required={required}
        dataComponent={dataComponent ? `${dataComponent}-label` : "field-label"}
      >
        {label}
      </Label>
      {children}
      {error && (
        <span
          data-component={
            dataComponent ? `${dataComponent}-error` : "field-error"
          }
          role="alert"
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-error)",
            marginTop: "var(--space-1)",
            display: "block",
          }}
        >
          {error}
        </span>
      )}
      {helperText && !error && (
        <span
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-neutral-400)",
            marginTop: "var(--space-1)",
            display: "block",
          }}
        >
          {helperText}
        </span>
      )}
    </div>
  );
}
