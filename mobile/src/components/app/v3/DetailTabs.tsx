"use client";

import { motion, useReducedMotion } from "framer-motion";
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
  const prefersReducedMotion = useReducedMotion();

  return (
    <div data-component="detail-tabs" className="relative flex gap-1 border-b border-v3-border">
      {tabs.map((tab) => (
        <button
          data-component="detail-tabs-button"
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={cn(
            "relative flex-1 text-center text-[0.8rem] pb-2 px-3 transition-colors",
            activeTab === tab.key ? "text-primary font-semibold" : "text-v3-text-muted hover:text-v3-text"
          )}
        >
          {tab.label}
          {activeTab === tab.key ? (
            prefersReducedMotion ? (
              <div
                data-component="detail-tabs-indicator"
                className="absolute bottom-0 left-0 h-0.5 w-full bg-primary"
              />
            ) : (
              <motion.div
                data-component="detail-tabs-indicator"
                layoutId="detail-tabs-indicator"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                className="absolute bottom-0 left-0 h-0.5 w-full bg-primary"
              />
            )
          ) : null}
        </button>
      ))}
    </div>
  );
}
