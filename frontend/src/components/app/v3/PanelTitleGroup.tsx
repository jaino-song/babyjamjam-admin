"use client";

import React from "react";
import { cn } from "@/lib/utils";

const SOURCE_COMPONENT = "PanelTitleGroup";

export type PanelTitleNoticeTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * A one-line notice under the subtitle, for state the reader should know before
 * reading the rest of the panel (e.g. "계약서와 정보가 달라요").
 */
export interface PanelTitleNotice {
  tone?: PanelTitleNoticeTone;
  /** Optional leading icon; sized to 14px by the slot. */
  icon?: React.ReactNode;
  content: React.ReactNode;
}

const NOTICE_TONE_CLASS_NAME: Record<PanelTitleNoticeTone, string> = {
  neutral: "text-status-neutral-fg",
  info: "text-status-info-fg",
  success: "text-status-success-fg",
  warning: "text-status-warning-fg",
  danger: "text-status-danger-fg",
};

interface PanelTitleGroupProps {
  "data-component"?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Badges rendered before the title (leftmost position) */
  badgesLeft?: React.ReactNode;
  /** Badges rendered after the title (default position) */
  badges?: React.ReactNode;
  /** Badges pushed to the far right of the title row */
  badgesRight?: React.ReactNode;
  /** One-line notice rendered under the subtitle */
  notice?: PanelTitleNotice | null;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
}

export function PanelTitleGroup({
  "data-component": dataComponent,
  title,
  subtitle,
  badgesLeft,
  badges,
  badgesRight,
  notice,
  className,
  titleClassName,
  subtitleClassName,
}: PanelTitleGroupProps) {
  const noticeTone = notice?.tone ?? "warning";
  return (
    <div
      data-component={dataComponent || undefined}
      data-source-component={SOURCE_COMPONENT}
      className={cn("flex min-w-0 flex-col gap-[calc(2px*var(--glint-ui-scale,1))]", className)}
    >
      <div data-component={dataComponent ? `${dataComponent}_title-row` : undefined} className="flex flex-wrap items-center gap-[calc(6px*var(--glint-ui-scale,1))]">
        {badgesLeft}
        <h2 data-component={dataComponent ? `${dataComponent}_title-row_title` : undefined} className={cn("truncate font-bold text-v3-dark", titleClassName)}>
          {title}
        </h2>
        {badges}
        {badgesRight ? (
          <div
            data-component={dataComponent ? `${dataComponent}_title-row_badges-right` : undefined}
            className="ml-auto flex shrink-0 items-center gap-[calc(6px*var(--glint-ui-scale,1))]"
          >
            {badgesRight}
          </div>
        ) : null}
      </div>
      {subtitle ? (
        <p data-component={dataComponent ? `${dataComponent}_subtitle` : undefined} data-slot="panel-subtitle" className={cn("text-[calc(12.8px*var(--glint-ui-scale,1))] text-v3-text-muted", subtitleClassName)}>
          {subtitle}
        </p>
      ) : null}
      {notice ? (
        <p
          data-component={dataComponent ? `${dataComponent}_notice` : undefined}
          data-slot="panel-notice"
          data-tone={noticeTone}
          role="status"
          className={cn(
            "mt-[calc(6px*var(--glint-ui-scale,1))] flex items-center gap-[calc(6px*var(--glint-ui-scale,1))] text-[calc(12.8px*var(--glint-ui-scale,1))] leading-[1.4] [&>svg]:size-[calc(14px*var(--glint-ui-scale,1))] [&>svg]:shrink-0",
            NOTICE_TONE_CLASS_NAME[noticeTone],
          )}
        >
          {notice.icon}
          <span className="min-w-0">{notice.content}</span>
        </p>
      ) : null}
    </div>
  );
}
