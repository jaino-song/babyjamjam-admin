"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";

interface DetailPanelProps {
  header: React.ReactNode;
  children: React.ReactNode;
}

export function DetailPanel({ header, children }: DetailPanelProps) {
  const nav = useSplitLayoutNavOptional();
  const showBackButton = nav?.isMobile;

  return (
    <div data-component="detail-panel" className={`bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden ${nav?.isMobile ? "" : "animate-v3-slide-up"}`}>
      {/* Back button - mobile only */}
      {showBackButton && (
        <button
          onClick={nav?.goToList}
          className="flex items-center gap-1 px-4 pt-4 text-[0.8rem] text-v3-text-muted hover:text-v3-primary transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      <div data-component="detail-panel-header" className={showBackButton ? "p-6 pt-2" : "p-6"}>
        {header}
      </div>
      <div className="overflow-y-auto p-6 pt-0">
        {children}
      </div>
    </div>
  );
}
