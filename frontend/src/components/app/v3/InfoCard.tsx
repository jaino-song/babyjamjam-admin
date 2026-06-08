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
    <div data-component={dataComponent} className={cn("bg-v3-dim-white rounded-[18px] p-4", className)}>
      <h3 data-component="info-card-title" className="text-[0.65rem] uppercase tracking-[0.1em] text-v3-text-muted font-semibold mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
