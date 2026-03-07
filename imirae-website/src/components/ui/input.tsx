"use client";

import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  dataComponent?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ error = false, dataComponent, style, ...props }, ref) {
    return (
      <input
        ref={ref}
        data-component={dataComponent ?? "input"}
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
          transition: "border-color var(--duration-fast) var(--ease-default)",
          ...style,
        }}
        {...props}
      />
    );
  }
);
