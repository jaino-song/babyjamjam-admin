"use client";

import React from "react";

import { cn } from "@/lib/utils";

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  className?: string;
  "data-component"?: string;
}

export function InfoRow({
  label,
  value,
  className,
  "data-component": dataComponent = "info-row",
}: InfoRowProps) {
  return (
    <div
      data-component={dataComponent}
      className={cn("flex items-start gap-[calc(16px*var(--glint-ui-scale,1))] border-b border-v3-border py-[calc(10px*var(--glint-ui-scale,1))] last:border-b-0", className)}
    >
      <span className="shrink-0 text-[calc(14px*var(--glint-ui-scale,1))] text-v3-text-muted">{label}</span>
      <span className="ml-auto min-w-0 flex-1 text-right text-[calc(14px*var(--glint-ui-scale,1))] font-semibold text-v3-dark">
        {value}
      </span>
    </div>
  );
}
