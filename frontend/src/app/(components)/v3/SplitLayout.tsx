"use client";

import React, { useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { useIsMobile } from "@/app/hooks/useIsMobile";
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
          className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6"
        >
          {children}
        </div>
      </SplitLayoutContext.Provider>
    );
  }

  // Mobile: render as carousel
  const activeSlide = hasSelection ? 1 : 0;

  return (
    <SplitLayoutContext.Provider value={contextValue}>
      <div
        data-component="split-layout"
        className="overflow-hidden w-full"
      >
        <motion.div
          className="grid grid-cols-2 w-[200%]"
          animate={{ x: activeSlide === 0 ? "0%" : "-50%" }}
          transition={{
            type: "spring",
            stiffness: 300,
            damping: 30,
          }}
        >
          {/* Slide 1: ListPanel */}
          <div className="flex flex-col">
            {listPanel}
          </div>
          {/* Slide 2: DetailPanel */}
          <div className="flex flex-col">
            {detailPanel}
          </div>
        </motion.div>
      </div>
    </SplitLayoutContext.Provider>
  );
}
