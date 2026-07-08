"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ToggleRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
}

export function ToggleRow({
  title,
  description,
  checked,
  className,
  disabled,
  type = "button",
  ...props
}: ToggleRowProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-component="toggle-row"
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border border-v3-border bg-white px-3.5 py-3 text-left transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.85rem] font-semibold text-v3-dark">{title}</span>
        {description ? (
          <span className="text-[0.68rem] text-v3-text-muted">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-[42px] shrink-0 rounded-full bg-v3-border transition-colors",
          checked && "bg-v3-primary",
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-[18px]",
          )}
        />
      </span>
    </button>
  );
}
