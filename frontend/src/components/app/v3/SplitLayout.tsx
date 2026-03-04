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
}

export function SplitLayout({ children, hasSelection = false, onBack }: SplitLayoutProps) {
  const isMobile = useIsMobile();

  // Extract ListPanel and DetailPanel from children
  const childArray = React.Children.toArray(children);
  const listPanel = childArray[0];
  const detailPanel = childArray[1];

  // Handler for back button in DetailPanel
  const goToList = useCallback(() => {
    onBack?.();
  }, [onBack]);

  const contextValue = useMemo(
    () => ({ goToList, isMobile }),
    [goToList, isMobile]
  );

  // Desktop: render as grid (original behavior)
  if (!isMobile) {
    return (
      <SplitLayoutContext.Provider value={contextValue}>
        <div
          data-component="split-layout"
          className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 flex-1 h-full min-h-0 pr-15"
        >
          {children}
        </div>
      </SplitLayoutContext.Provider>
    );
  }

  // Mobile: carousel with horizontal slide transition
  return (
    <SplitLayoutContext.Provider value={contextValue}>
      <div data-component="split-layout" className="w-full h-full min-h-0 overflow-hidden relative">
        <div
          className="absolute inset-0 flex transition-transform duration-300 ease-out"
          style={{ transform: hasSelection ? "translateX(-100%)" : "translateX(0)" }}
        >
          <div className="w-full h-full min-h-0 flex-shrink-0">{listPanel}</div>
          <div className="w-full h-full min-h-0 flex-shrink-0 overflow-y-auto">{detailPanel}</div>
        </div>
      </div>
    </SplitLayoutContext.Provider>
  );
}
