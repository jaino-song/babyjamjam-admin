"use client";

import { type TextareaHTMLAttributes, forwardRef } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  dataComponent?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ error = false, dataComponent, rows = 4, style, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        data-component={dataComponent ?? "textarea"}
        rows={rows}
        aria-invalid={error}
        style={{
          width: "100%",
          padding: "12px 16px",
          border: `1px solid ${error ? "var(--color-error)" : "var(--color-neutral-300)"}`,
          borderRadius: "var(--radius-md)",
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-base)",
          color: "var(--color-neutral-800)",
          background: "var(--color-neutral-0)",
          outline: "none",
          resize: "vertical" as const,
          transition: "border-color var(--duration-fast) var(--ease-default)",
          ...style,
        }}
        {...props}
      />
    );
  }
);
