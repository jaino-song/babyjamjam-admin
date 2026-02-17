"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";

interface DetailPanelProps {
  header?: React.ReactNode;
  avatar?: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  trailing?: React.ReactNode;
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
  tabs,
  children,
}: DetailPanelProps) {
  const nav = useSplitLayoutNavOptional();
  const showBackButton = nav?.isMobile;

  const hasStructuredHeader = !!title;

  const renderedHeader = hasStructuredHeader ? (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        {avatar}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-v3-dark truncate">{title}</h2>
            {badges}
          </div>
          {subtitle && (
            <p className="text-[0.8rem] text-v3-text-muted mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {trailing}
    </div>
  ) : header;

  return (
    <div data-component="detail-panel" className={`bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden ${nav?.isMobile ? "" : "animate-v3-slide-up"}`}>
      {showBackButton && (
        <button
          onClick={nav?.goToList}
          className="flex items-center gap-1 px-4 pt-4 text-[0.8rem] text-v3-text-muted hover:text-v3-primary transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      {renderedHeader && <div data-component="detail-panel-header" className={showBackButton ? "p-6 pt-2" : "p-6"}>
        {renderedHeader}
      </div>}
      {tabs && <div className="px-6 pt-4">{tabs}</div>}
      <div className="relative flex-1 min-h-0">
        <div className="overflow-y-auto h-full p-6 pt-0">
          {children}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-white pointer-events-none z-20 rounded-b-[28px]" />
      </div>
    </div>
  );
}
