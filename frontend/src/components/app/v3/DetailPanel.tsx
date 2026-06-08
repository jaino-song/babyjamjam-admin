"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";
import { useScrollActivity } from "./useScrollActivity";

interface DetailPanelProps {
  /** Fully custom header (escape hatch for centered layouts etc.) */
  header?: React.ReactNode;
  /** Optional avatar element on the left */
  avatar?: React.ReactNode;
  /** Title text or node */
  title?: React.ReactNode;
  /** Subtitle below the title */
  subtitle?: React.ReactNode;
  /** Badges/chips inline with the title */
  badges?: React.ReactNode;
  /** Trailing content on the right side of the header (e.g. Stepper) */
  trailing?: React.ReactNode;
  /** Optional action row rendered between header and tabs. */
  headerAction?: React.ReactNode;
  compactBackLabel?: React.ReactNode;
  tabs?: React.ReactNode;
  overlay?: React.ReactNode;
  emptyState?: React.ReactNode;
  children: React.ReactNode;
}

export function DetailPanel({
  header = null,
  avatar,
  title,
  subtitle,
  badges,
  trailing,
  headerAction,
  compactBackLabel = "목록으로 돌아가기",
  tabs,
  overlay,
  emptyState,
  children,
}: DetailPanelProps) {
  const splitLayoutNav = useSplitLayoutNavOptional();
  const { isScrollActive, handleScroll } = useScrollActivity();
  const resolvedOverlay = overlay ?? emptyState;
  const showCompactBackButton = splitLayoutNav?.isMobile ?? false;

  const hasStructuredHeader = !!title;

  const renderedHeader = hasStructuredHeader ? (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        {avatar}
        <PanelTitleGroup
          component="detail-panel"
          title={title}
          subtitle={subtitle}
          badges={badges}
          titleClassName="text-base"
        />
      </div>
      {trailing}
    </div>
  ) : header;

  return (
    <div data-component="detail-panel" className="relative bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden h-full min-h-0">
      {(showCompactBackButton || renderedHeader) && <div data-component="detail-panel-header" className="px-6 py-5">
        {showCompactBackButton && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[0.75rem] md:text-[0.8rem] font-semibold text-v3-text-muted hover:text-v3-primary transition-colors mb-4 md:mb-6 self-start"
            onClick={splitLayoutNav?.goToList}
          >
            <ChevronLeft className="w-[18px] h-[18px] md:w-5 md:h-5" aria-hidden="true" />
            {compactBackLabel}
          </button>
        )}
        {renderedHeader}
      </div>}
      {headerAction && <div className="px-6 pb-6">{headerAction}</div>}
      {tabs && <div className="px-6">{tabs}</div>}
      {resolvedOverlay ? (
        <div
          data-component="detail-panel-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 -translate-y-3"
        >
          {resolvedOverlay}
        </div>
      ) : null}
      <div className="relative flex-1 min-h-0">
        <div
          data-component="detail-panel-scroll-content"
          className="overflow-y-auto scrollbar-on-scroll h-full px-6 pt-6 pb-6"
          data-scroll-active={isScrollActive ? "true" : "false"}
          onScroll={handleScroll}
        >
          {children}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-white pointer-events-none z-20 rounded-b-[28px]" />
      </div>
    </div>
  );
}
