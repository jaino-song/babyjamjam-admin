"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface TabItem {
  label: string;
  value: string;
}

interface ListPanelProps {
  title: string;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  /** Shows skeleton for tabs (initial load only) */
  isLoading?: boolean;
  /** Shows skeleton for content only (filter changes) */
  isContentLoading?: boolean;
  tabsSkeletonCount?: number;
  contentSkeleton?: React.ReactNode;
}

export function ListPanel({
  title,
  tabs,
  activeTab,
  onTabChange,
  children,
  headerActions,
  isLoading = false,
  isContentLoading = false,
  tabsSkeletonCount = 3,
  contentSkeleton,
}: ListPanelProps) {
  const showTabs = (tabs && tabs.length > 0) || (isLoading && tabsSkeletonCount > 0);
  const showContentSkeleton = (isLoading || isContentLoading) && contentSkeleton;

  return (
    <div data-component="list-panel" className="bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-6 pb-0">
        <h2 className="text-lg font-bold text-v3-dark">{title}</h2>
        {headerActions && <div>{headerActions}</div>}
      </div>

      {showTabs && (
        <div data-component="list-panel-tabs" className="flex gap-1 px-6 pt-4">
          {isLoading
            ? (tabs && tabs.length > 0
              ? tabs.map((tab) => tab.value)
              : Array.from({ length: tabsSkeletonCount }, (_, i) => `skeleton-${i}`)
            ).map((key, idx) => (
              <div
                key={key}
                data-component="list-panel-tabs-skeleton"
                className="pb-2 px-3"
                style={{ opacity: 0.9 - idx * 0.08 }}
              >
                <Skeleton className="h-4 w-14 rounded-full bg-v3-dim-white" />
                <div className="h-2" />
              </div>
            ))
            : (tabs ?? []).map((tab) => (
              <button
                key={tab.value}
                onClick={() => onTabChange?.(tab.value)}
                className={`text-[0.8rem] pb-2 px-3 transition-colors ${activeTab === tab.value
                  ? "text-v3-primary font-semibold border-b-2 border-v3-primary"
                  : "text-v3-text-muted hover:text-v3-text"
                  }`}
              >
                {tab.label}
              </button>
            ))}
        </div>
      )}

      <div data-component="list-panel-content" className="overflow-y-auto p-6">
        {showContentSkeleton ? contentSkeleton : children}
      </div>
    </div>
  );
}
