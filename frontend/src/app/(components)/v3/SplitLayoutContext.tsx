"use client";

import { createContext, useContext } from "react";

export interface SplitLayoutContextValue {
  goToList: () => void;
  isMobile: boolean;
}

export const SplitLayoutContext = createContext<SplitLayoutContextValue | null>(null);

export function useSplitLayoutNav() {
  const context = useContext(SplitLayoutContext);
  if (!context) {
    throw new Error("useSplitLayoutNav must be used within a SplitLayout");
  }
  return context;
}

/**
 * Optional version that returns null when used outside SplitLayout
 * Used by DetailPanel for graceful degradation
 */
export function useSplitLayoutNavOptional(): SplitLayoutContextValue | null {
  return useContext(SplitLayoutContext);
}
