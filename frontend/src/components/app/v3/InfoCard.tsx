"use client";

import React from "react";

import { cn } from "@/lib/utils";

interface InfoCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  "data-component"?: string;
}

export function InfoCard({
  title,
  children,
  className,
  "data-component": dataComponent = "info-card",
}: InfoCardProps) {
  return (
    <div data-component={dataComponent} className={cn("rounded-[18px] bg-v3-dim-white p-[calc(16px*var(--v3-ui-scale,1))]", className)}>
      <h3 data-component="info-card-title" className="mb-[calc(12px*var(--v3-ui-scale,1))] text-[calc(12px*var(--v3-ui-scale,1))] font-semibold uppercase tracking-[0.1em] text-v3-text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}
