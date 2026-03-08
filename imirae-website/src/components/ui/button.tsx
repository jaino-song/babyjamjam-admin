"use client";

import { type ButtonHTMLAttributes, type ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  loading?: boolean;
  dataComponent?: string;
  children: ReactNode;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: {
    background: "var(--color-primary-500)",
    color: "#FFFFFF",
    border: "none",
  },
  secondary: {
    background: "var(--color-secondary-500)",
    color: "#FFFFFF",
    border: "none",
  },
  outline: {
    background: "transparent",
    color: "var(--color-primary-500)",
    border: "2px solid var(--color-primary-500)",
  },
  ghost: {
    background: "transparent",
    color: "var(--color-neutral-700)",
    border: "none",
  },
};

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: {
    padding: "8px 16px",
    fontSize: "var(--text-sm)",
    height: "36px",
  },
  md: {
    padding: "12px 24px",
    fontSize: "var(--text-base)",
    height: "44px",
  },
  lg: {
    padding: "16px 32px",
    fontSize: "var(--text-lg)",
    height: "52px",
  },
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled = false,
  dataComponent,
  children,
  style,
  ...props
}: ButtonProps) {
  return (
    <button
      data-component={dataComponent ?? "button"}
      disabled={disabled || loading}
      aria-disabled={disabled || loading}
      aria-busy={loading}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-2)",
        fontWeight: "var(--font-semibold)" as string,
        borderRadius: "var(--radius-md)",
        transition: "all var(--duration-fast) var(--ease-default)",
        whiteSpace: "nowrap",
        cursor: disabled || loading ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? "100%" : undefined,
        animation: "fadeIn var(--duration-normal) var(--ease-out)",
        ...variantStyles[variant],
        ...sizeStyles[size],
        ...style,
      }}
      {...props}
    >
      {loading ? (
        <span
          style={{
            width: "16px",
            height: "16px",
            border: "2px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </button>
  );
}
