"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface PanelTitleGroupProps {
  component: "list-panel" | "detail-panel";
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Badges rendered before the title (leftmost position) */
  badgesLeft?: React.ReactNode;
  /** Badges rendered after the title (default position) */
  badges?: React.ReactNode;
  /** Badges pushed to the far right of the title row */
  badgesRight?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
}

export function PanelTitleGroup({
  component,
  title,
  subtitle,
  badgesLeft,
  badges,
  badgesRight,
  className,
  titleClassName,
  subtitleClassName,
}: PanelTitleGroupProps) {
  return (
    <div data-component={`${component}-title-group`} className={cn("flex min-w-0 flex-col gap-[calc(2px*var(--glint-ui-scale,1))]", className)}>
      <div data-component={`${component}-title-row`} className="flex flex-wrap items-center gap-[calc(6px*var(--glint-ui-scale,1))]">
        {badgesLeft}
        <h2 data-component={`${component}-title`} className={cn("truncate font-bold text-v3-dark", titleClassName)}>
          {title}
        </h2>
        {badges}
        {badgesRight ? <div className="ml-auto flex shrink-0 items-center gap-[calc(6px*var(--glint-ui-scale,1))]">{badgesRight}</div> : null}
      </div>
      {subtitle ? (
        <p data-component={`${component}-subtitle`} className={cn("text-[calc(12.8px*var(--glint-ui-scale,1))] text-v3-text-muted", subtitleClassName)}>
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}
