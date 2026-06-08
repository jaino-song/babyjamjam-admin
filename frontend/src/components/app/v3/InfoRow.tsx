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
      className={cn("flex items-start gap-4 py-2.5 border-b border-v3-border last:border-b-0", className)}
    >
      <span className="shrink-0 text-[0.75rem] text-v3-text-muted">{label}</span>
      <span className="ml-auto min-w-0 flex-1 text-[0.75rem] font-semibold text-v3-dark text-right">
        {value}
      </span>
    </div>
  );
}
