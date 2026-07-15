"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const baseStyles =
  "flex items-center gap-[calc(4px*var(--glint-ui-scale,1))] rounded-xl px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(6px*var(--glint-ui-scale,1))] text-[calc(11.2px*var(--glint-ui-scale,1))] font-semibold transition-colors";

const variantStyles = {
  primary: "text-v3-primary hover:bg-v3-primary-light",
  muted: "text-v3-text-muted hover:bg-v3-dim-white",
} as const;

export interface HeaderActionButtonProps {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: keyof typeof variantStyles;
  "data-component"?: string;
  "data-testid"?: string;
  className?: string;
}

export function HeaderActionButton({
  icon: Icon,
  label,
  href,
  onClick,
  variant = "primary",
  className,
  ...rest
}: HeaderActionButtonProps) {
  const classes = cn(baseStyles, variantStyles[variant], className);

  const content = (
    <>
      {Icon && <Icon className="h-[calc(14px*var(--glint-ui-scale,1))] w-[calc(14px*var(--glint-ui-scale,1))]" />}
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes} {...rest}>
      {content}
    </button>
  );
}
