"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";

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
  tabs,
  overlay,
  emptyState,
  children,
}: DetailPanelProps) {
  const nav = useSplitLayoutNavOptional();
  const showBackButton = nav?.isMobile;
  const resolvedOverlay = overlay ?? emptyState;

  const hasStructuredHeader = !!title;

  const renderedHeader = hasStructuredHeader ? (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        {avatar}
        <PanelTitleGroup
          component="detail-panel"
          title={title}
          subtitle={subtitle}
          badges={badges}
          titleClassName="text-xl"
        />
      </div>
      {trailing}
    </div>
  ) : header;

  return (
    <div data-component="detail-panel" className="relative bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden h-full min-h-0">
      {/* Back button - mobile only */}
      {showBackButton && (
        <button
          onClick={nav?.goToList}
          className="flex items-center gap-1 px-4 pt-4 text-[0.8rem] text-v3-text-muted hover:text-v3-primary transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      {renderedHeader && <div data-component="detail-panel-header" className={showBackButton ? "px-6 pt-2" : "p-6"}>
        {renderedHeader}
      </div>}
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
          className="overflow-y-auto h-full px-6 pt-6 pb-6"
        >
          {children}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-white pointer-events-none z-20 rounded-b-[28px]" />
      </div>
    </div>
  );
}
