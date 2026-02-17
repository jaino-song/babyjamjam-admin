"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const baseStyles =
  "inline-flex items-center gap-2 rounded-[14px] px-5 py-2.5 text-[0.85rem] font-semibold transition-all duration-300 hover:-translate-y-0.5 active:scale-95";

const variantStyles = {
  primary:
    "bg-v3-primary text-white shadow-v3 hover:shadow-v3-hover",
  outline:
    "border-2 border-v3-border bg-white text-v3-text hover:border-v3-primary hover:text-v3-primary",
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
      {Icon && <Icon className="h-4 w-4" />}
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
