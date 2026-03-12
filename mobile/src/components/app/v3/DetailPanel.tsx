"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";

interface DetailPanelProps {
  header?: React.ReactNode;
  avatar?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  trailing?: React.ReactNode;
  mobileActions?: React.ReactNode;
  actions?: React.ReactNode;
  tabs?: React.ReactNode;
  children: React.ReactNode;
}

export function DetailPanel({
  header = null,
  avatar,
  title,
  subtitle,
  badges,
  trailing,
  mobileActions,
  tabs,
  actions,
  children,
}: DetailPanelProps) {
  const nav = useSplitLayoutNavOptional();
  const showBackButton = nav?.isMobile;

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
    <div data-component="detail-panel" className={`bg-white rounded-2xl shadow-v3 flex flex-col gap-4 overflow-hidden h-full min-h-0 ${nav?.isMobile ? "" : "animate-v3-slide-up"}`}>
      {showBackButton && (
        <div
          data-component="detail-panel-mobile-nav"
          className="flex items-center justify-between px-4 pt-4"
        >
          <button
            data-component="detail-panel-mobile-nav-back"
            onClick={nav?.goToList}
            className="flex items-center gap-1 text-[0.8rem] text-v3-text-muted hover:text-v3-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          {mobileActions && (
            <div data-component="detail-panel-mobile-nav-actions" className="flex items-center">
              {mobileActions}
            </div>
          )}
        </div>
      )}

      {renderedHeader && <div data-component="detail-panel-header" className={showBackButton ? "px-6 pt-2" : "p-6"}>
        {renderedHeader}
      </div>}
      {actions && <div data-component="detail-panel-actions" className="px-6">{actions}</div>}
      {tabs && <div className="px-6">{tabs}</div>}
      <div className="relative flex-1 min-h-0">
        <div className="overflow-y-auto h-full px-6 py-4">
          {children}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-white pointer-events-none z-20 rounded-b-2xl" />
      </div>
    </div>
  );
}
