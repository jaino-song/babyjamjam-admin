import { type ReactNode } from "react";

interface CardProps {
  variant?: "elevated" | "outlined" | "filled";
  padding?: "sm" | "md" | "lg";
  hoverable?: boolean;
  dataComponent?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}

const paddingMap: Record<string, string> = {
  sm: "16px",
  md: "24px",
  lg: "32px",
};

export function Card({
  variant = "elevated",
  padding = "md",
  hoverable = false,
  dataComponent,
  children,
  style,
}: CardProps) {
  const baseStyle: React.CSSProperties = {
    background: "var(--color-bg-card)",
    borderRadius: "var(--radius-md)",
    padding: paddingMap[padding],
    transition: hoverable
      ? "all var(--duration-normal) var(--ease-default)"
      : undefined,
    animation: "fadeInUp var(--duration-normal) var(--ease-out)",
    animationFillMode: "both",
  };

  if (variant === "elevated") {
    baseStyle.boxShadow = "var(--shadow-md)";
  } else if (variant === "outlined") {
    baseStyle.border = "1px solid var(--color-neutral-200)";
  } else if (variant === "filled") {
    baseStyle.background = "var(--color-neutral-50)";
  }

  return (
    <div data-component={dataComponent ?? "card"} style={{ ...baseStyle, ...style }}>
      {children}
    </div>
  );
}
