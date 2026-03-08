import { type ReactNode } from "react";

interface BadgeProps {
  variant?: "primary" | "secondary" | "accent" | "neutral";
  size?: "sm" | "md";
  dataComponent?: string;
  children: ReactNode;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: {
    background: "var(--color-primary-100)",
    color: "var(--color-primary-700)",
  },
  secondary: {
    background: "var(--color-secondary-100)",
    color: "var(--color-secondary-700)",
  },
  accent: {
    background: "var(--color-accent-100)",
    color: "var(--color-accent-700)",
  },
  neutral: {
    background: "var(--color-neutral-200)",
    color: "var(--color-neutral-700)",
  },
};

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: {
    padding: "4px 12px",
    fontSize: "var(--text-xs)",
  },
  md: {
    padding: "6px 16px",
    fontSize: "var(--text-sm)",
  },
};

export function Badge({
  variant = "primary",
  size = "sm",
  dataComponent,
  children,
}: BadgeProps) {
  return (
    <span
      data-component={dataComponent ?? "badge"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: "var(--radius-full)",
        fontWeight: "var(--font-medium)" as string,
        ...variantStyles[variant],
        ...sizeStyles[size],
      }}
    >
      {children}
    </span>
  );
}
