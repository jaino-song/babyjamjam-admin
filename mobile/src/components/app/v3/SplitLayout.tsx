"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { SplitLayoutContext } from "./SplitLayoutContext";

export { useSplitLayoutNav } from "./SplitLayoutContext";

interface SplitLayoutProps {
  children: React.ReactNode;
  hasSelection?: boolean;
  onBack?: () => void;
  /** When true, height is driven purely by content — skips viewport-fill logic. */
  autoHeight?: boolean;
}

export function SplitLayout({ children, hasSelection = false, onBack, autoHeight = false }: SplitLayoutProps) {
  const isMobile = useIsMobile();
  const splitLayoutRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [activeHeight, setActiveHeight] = useState<number | undefined>();
  const [viewportMinHeight, setViewportMinHeight] = useState<number | undefined>();

  const updateViewportMinHeight = useCallback(() => {
    if (!isMobile || autoHeight) return;

    const container = splitLayoutRef.current;
    if (!container) return;

    const shell = container.closest<HTMLElement>("[data-component='app-root']");
    const containerRect = container.getBoundingClientRect();
    const shellBottom = shell?.getBoundingClientRect().bottom ?? window.innerHeight;
    const next = Math.max(0, Math.floor(shellBottom - containerRect.top));

    setViewportMinHeight((prev) => (prev === next ? prev : next));
  }, [isMobile, autoHeight]);

  useLayoutEffect(() => {
    if (!isMobile) return;

    const container = splitLayoutRef.current;
    if (!container) return;

    const shell = container.closest<HTMLElement>("[data-component='app-root']");
    let frame = 0;

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        updateViewportMinHeight();
      });
    };

    scheduleUpdate();

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("orientationchange", scheduleUpdate);
    shell?.addEventListener("scroll", scheduleUpdate, { passive: true });

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(container);
    if (container.parentElement) {
      observer.observe(container.parentElement);
    }
    if (shell) {
      observer.observe(shell);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("orientationchange", scheduleUpdate);
      shell?.removeEventListener("scroll", scheduleUpdate);
    };
  }, [isMobile, updateViewportMinHeight]);

  useLayoutEffect(() => {
    if (!isMobile) return;

    const el = hasSelection ? detailRef.current : listRef.current;
    if (!el) return;

    const update = () => {
      setActiveHeight(el.getBoundingClientRect().height);
      updateViewportMinHeight();
    };
    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasSelection, isMobile, updateViewportMinHeight]);

  useEffect(() => {
    if (isMobile && hasSelection) {
      window.scrollTo({ top: 0 });
    }
  }, [hasSelection, isMobile]);

  const childArray = React.Children.toArray(children);
  const listPanel = childArray[0];
  const detailPanel = childArray[1];
  const showDetailPanel = hasSelection && detailPanel != null;

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
          className={cn(
            "grid grid-cols-1 gap-6 h-full min-h-0",
            showDetailPanel && "lg:grid-cols-[380px_1fr]"
          )}
        >
          {listPanel}
          {showDetailPanel ? detailPanel : null}
        </div>
      </SplitLayoutContext.Provider>
    );
  }

  return (
    <SplitLayoutContext.Provider value={contextValue}>
      <div
        ref={splitLayoutRef}
        data-component="split-layout"
        className="w-full min-h-0 overflow-hidden transition-[height] duration-300 ease-out"
        style={{
          height: activeHeight,
          minHeight: viewportMinHeight,
        }}
      >
        <div
          className="flex h-full min-h-0 items-start transition-transform duration-300 ease-out"
          style={{ transform: hasSelection ? "translateX(-100%)" : "translateX(0)" }}
        >
          <div ref={listRef} className="w-full h-full min-h-0 flex-shrink-0">{listPanel}</div>
          <div ref={detailRef} className="w-full h-full min-h-0 flex-shrink-0">{detailPanel}</div>
        </div>
      </div>
    </SplitLayoutContext.Provider>
  );
}
