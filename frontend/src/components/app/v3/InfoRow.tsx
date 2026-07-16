"use client";

import React from "react";

import { cn } from "@/lib/utils";

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  size?: "default" | "compact";
  className?: string;
  "data-component"?: string;
}

export function InfoRow({
  label,
  value,
  size = "default",
  className,
  "data-component": dataComponent = "info-row",
}: InfoRowProps) {
  return (
    <div
      data-component={dataComponent}
      className={cn("flex items-start gap-[calc(16px*var(--glint-ui-scale,1))] border-b border-v3-border py-[calc(10px*var(--glint-ui-scale,1))] last:border-b-0", className)}
    >
      <span className={cn(
        "shrink-0 text-v3-text-muted",
        size === "compact"
          ? "text-[calc(12px*var(--glint-ui-scale,1))]"
          : "text-[calc(14px*var(--glint-ui-scale,1))]",
      )}>{label}</span>
      <span className={cn(
        "ml-auto min-w-0 flex-1 text-right font-semibold text-v3-dark",
        size === "compact"
          ? "text-[calc(12px*var(--glint-ui-scale,1))]"
          : "text-[calc(14px*var(--glint-ui-scale,1))]",
      )}>
        {value}
      </span>
    </div>
  );
}
