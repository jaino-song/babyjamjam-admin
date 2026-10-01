"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "ToggleRow";

export interface ToggleRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  "data-component"?: string;
}

export function ToggleRow({
  title,
  description,
  checked,
  className,
  disabled,
  type = "button",
  "data-component": dataComponent,
  ...props
}: ToggleRowProps) {
  const sub = (suffix: string) => dataComponent ? `${dataComponent}_${suffix}` : undefined;

  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-white px-3.5 py-3 text-left transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span data-component={sub("copy")} className="flex min-w-0 flex-col gap-0.5">
        <span data-component={sub("title")} className="text-[0.85rem] font-semibold text-dark">
          {title}
        </span>
        {description ? (
          <span data-component={sub("description")} className="text-[0.68rem] text-text-muted">
            {description}
          </span>
        ) : null}
      </span>
      <span
        data-component={sub("track")}
        aria-hidden="true"
        className={cn(
          "relative h-6 w-[42px] shrink-0 rounded-full bg-border transition-colors",
          checked && "bg-primary",
        )}
      >
        <span
          data-component={sub("thumb")}
          className={cn(
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked && "translate-x-[18px]",
          )}
        />
      </span>
    </button>
  );
}
