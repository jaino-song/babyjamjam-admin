"use client";

import * as React from "react";

export function useScrollActivity(timeoutMs = 450) {
  const [isScrollActive, setIsScrollActive] = React.useState(false);
  const scrollResetTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (scrollResetTimeoutRef.current !== null) {
        clearTimeout(scrollResetTimeoutRef.current);
      }
    };
  }, []);

  const handleScroll = React.useCallback(() => {
    setIsScrollActive(true);

    if (scrollResetTimeoutRef.current !== null) {
      clearTimeout(scrollResetTimeoutRef.current);
    }

    scrollResetTimeoutRef.current = setTimeout(() => {
      setIsScrollActive(false);
    }, timeoutMs);
  }, [timeoutMs]);

  return { isScrollActive, handleScroll };
}
