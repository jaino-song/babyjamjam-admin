"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface DetailTab {
  key: string;
  label: string;
}

export interface DetailTabsProps {
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
}

export function DetailTabs({ tabs, activeTab, onTabChange }: DetailTabsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicatorMetrics, setIndicatorMetrics] = useState({
    left: 0,
    width: 0,
    isReady: false,
  });

  const measureIndicator = useCallback(() => {
    const root = rootRef.current;
    const activeButton = buttonRefs.current[activeTab];

    if (!root || !activeButton) return;

    const rootRect = root.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    const nextMetrics = {
      left: buttonRect.left - rootRect.left,
      width: buttonRect.width,
      isReady: true,
    };

    setIndicatorMetrics((currentMetrics) =>
      currentMetrics.left === nextMetrics.left &&
      currentMetrics.width === nextMetrics.width &&
      currentMetrics.isReady === nextMetrics.isReady
        ? currentMetrics
        : nextMetrics
    );
  }, [activeTab]);

  useLayoutEffect(() => {
    measureIndicator();

    const root = rootRef.current;
    if (!root) return;

    const resizeObserver = new ResizeObserver(measureIndicator);
    resizeObserver.observe(root);
    tabs.forEach((tab) => {
      const button = buttonRefs.current[tab.key];
      if (button) resizeObserver.observe(button);
    });

    window.addEventListener("resize", measureIndicator);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureIndicator);
    };
  }, [measureIndicator, tabs]);

  return (
    <div
      ref={rootRef}
      data-component="detail-tabs"
      className="relative flex gap-[calc(4px*var(--v3-ui-scale,1))] border-b border-v3-border"
    >
      {tabs.map((tab) => (
        <button
          data-component="detail-tabs-button"
          key={tab.key}
          ref={(node) => {
            buttonRefs.current[tab.key] = node;
          }}
          onClick={() => onTabChange(tab.key)}
          className={cn(
            "relative px-[calc(12px*var(--v3-ui-scale,1))] pb-[calc(8px*var(--v3-ui-scale,1))] text-[calc(14px*var(--v3-ui-scale,1))] transition-colors",
            activeTab === tab.key
              ? "text-primary font-semibold"
              : "text-v3-text-muted hover:text-v3-text"
          )}
        >
          {tab.label}
        </button>
      ))}
      <div
        data-component="detail-tabs-indicator"
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 h-[calc(2px*var(--v3-ui-scale,1))] bg-primary",
          indicatorMetrics.isReady ? "opacity-100" : "opacity-0"
        )}
        style={{
          transform: `translateX(${indicatorMetrics.left}px)`,
          width: `${indicatorMetrics.width}px`,
        }}
      />
    </div>
  );
}
