"use client";

import React, { useState, useRef } from "react";
import { Search } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
  /** Search value (enables inline search when provided with onSearchChange) */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
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
  searchValue,
  onSearchChange,
  searchPlaceholder = "검색...",
  isLoading = false,
  isContentLoading = false,
  tabsSkeletonCount = 3,
  contentSkeleton,
}: ListPanelProps) {
  const showTabs = (tabs && tabs.length > 0) || (isLoading && tabsSkeletonCount > 0);
  const showContentSkeleton = (isLoading || isContentLoading) && contentSkeleton;
  const hasSearch = searchValue !== undefined && !!onSearchChange;
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <div data-component="list-panel" className="bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between p-6 pb-0 shrink-0">
        <h2 className="text-lg font-bold text-v3-dark">{title}</h2>
        {headerActions && <div>{headerActions}</div>}
      </div>

      {showTabs && (
        <div data-component="list-panel-tabs" className="flex items-center justify-between px-6 pt-4 shrink-0">
          <div className="flex gap-1">
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
          {hasSearch && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setSearchExpanded((prev) => {
                    if (!prev) setTimeout(() => searchInputRef.current?.focus(), 50);
                    else onSearchChange("");
                    return !prev;
                  });
                }}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center transition-colors hover:bg-v3-dim-white"
              >
                <Search className="w-[18px] h-[18px] text-v3-text-muted" />
              </button>
              <input
                ref={searchInputRef}
                type="text"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                onBlur={() => { if (!searchValue) setSearchExpanded(false); }}
                style={{ border: "none", outline: "none", boxShadow: "none" }}
                className={cn(
                  "bg-transparent text-[0.85rem] text-v3-dark caret-v3-primary placeholder:text-v3-text-muted/50 transition-all duration-250 ease-in-out",
                  searchExpanded ? "w-[120px]" : "w-0"
                )}
              />
            </div>
          )}
        </div>
      )}

      <div data-component="list-panel-content" className="p-6">
        {showContentSkeleton ? contentSkeleton : children}
      </div>
    </div>
  );
}
