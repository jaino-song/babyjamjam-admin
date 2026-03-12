"use client";

import React, { useCallback, useMemo } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { SplitLayoutContext } from "./SplitLayoutContext";

// Re-export the hook for external use
export { useSplitLayoutNav } from "./SplitLayoutContext";

interface SplitLayoutProps {
  children: React.ReactNode;
  hasSelection?: boolean;
  onBack?: () => void;
  columns?: 2 | 3;
  activePanel?: number;
}

function getDesktopGridClass(columns: 2 | 3): string {
  if (columns === 3) return "grid-cols-1 lg:grid-cols-3";
  return "grid-cols-1 lg:grid-cols-[380px_1fr]";
}

export function SplitLayout({
  children,
  hasSelection = false,
  onBack,
  columns = 2,
  activePanel = 0,
}: SplitLayoutProps) {
  const isMobile = useIsMobile();

  const childArray = React.Children.toArray(children);

  const goToList = useCallback(() => {
    onBack?.();
  }, [onBack]);

  const contextValue = useMemo(
    () => ({ goToList, isMobile }),
    [goToList, isMobile]
  );

  if (!isMobile) {
    return (
      <SplitLayoutContext.Provider value={contextValue}>
        <div
          data-component="split-layout"
          className={`grid ${getDesktopGridClass(columns)} gap-6 flex-1 h-full min-h-0`}
        >
          {childArray.map((child, index) => {
            const key = (child as React.ReactElement).key ?? `split-panel-${index}`;

            return (
              <div
                key={key}
                data-component="split-layout-panel"
                className="min-h-0 flex flex-col animate-v3-slide-up"
              >
                {child}
              </div>
            );
          })}
        </div>
      </SplitLayoutContext.Provider>
    );
  }

  const mobileOffset = columns === 3
    ? activePanel
    : hasSelection ? 1 : 0;

  return (
    <SplitLayoutContext.Provider value={contextValue}>
      <div data-component="split-layout" className="w-full h-full min-h-0 overflow-hidden relative">
        <div
          className="absolute inset-0 flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${mobileOffset * 100}%)` }}
        >
          {childArray.map((child, index) => {
            const key = (child as React.ReactElement).key ?? `split-panel-${index}`;
            return (
              <div key={key} className="w-full h-full min-h-0 flex-shrink-0 overflow-y-auto">
                {child}
              </div>
            );
          })}
        </div>
      </div>
    </SplitLayoutContext.Provider>
  );
}
