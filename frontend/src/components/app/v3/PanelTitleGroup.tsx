"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface PanelTitleGroupProps {
  component: "list-panel" | "detail-panel";
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
}

export function PanelTitleGroup({
  component,
  title,
  subtitle,
  badges,
  className,
  titleClassName,
  subtitleClassName,
}: PanelTitleGroupProps) {
  return (
    <div data-component={`${component}-title-group`} className={cn("min-w-0 flex flex-col gap-0.5", className)}>
      <div data-component={`${component}-title-row`} className="flex items-center gap-1.5 flex-wrap">
        <h2 data-component={`${component}-title`} className={cn("truncate font-bold text-v3-dark", titleClassName)}>
          {title}
        </h2>
        {badges}
      </div>
      {subtitle ? (
        <p data-component={`${component}-subtitle`} className={cn("text-[0.8rem] text-v3-text-muted", subtitleClassName)}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
