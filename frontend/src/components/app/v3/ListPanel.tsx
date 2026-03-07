"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExpandableSearch } from "./ExpandableSearch";

interface TabItem {
  label: string;
  value: string;
}

interface ListPanelProps {
  title: string;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  tabsVariant?: "inline" | "dropdown";
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  isLoading?: boolean;
  isContentLoading?: boolean;
  contentSkeleton?: React.ReactNode;
}

export function ListPanel({
  title,
  tabs,
  activeTab,
  onTabChange,
  tabsVariant = "inline",
  children,
  headerActions,
  searchValue,
  onSearchChange,
  searchPlaceholder = "검색...",
  isLoading = false,
  isContentLoading = false,
  contentSkeleton,
}: ListPanelProps) {
  const showTabs = tabs && tabs.length > 0;
  const showContentSkeleton = (isLoading || isContentLoading) && contentSkeleton;
  const hasSearch = searchValue !== undefined && !!onSearchChange;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const activeTabLabel = tabs?.find(t => t.value === activeTab)?.label ?? tabs?.[0]?.label ?? "";

  return (
    <div data-component="list-panel" className="bg-white rounded-[28px] shadow-v3 flex flex-col flex-1 self-stretch overflow-hidden h-full min-h-0">
      <div className="flex items-center justify-between p-6 pb-0 shrink-0">
        <h2 className="text-lg font-bold text-v3-dark">{title}</h2>
        {headerActions && <div>{headerActions}</div>}
      </div>

      {showTabs && (
        <div data-component="list-panel-tabs" className="flex items-center justify-between px-6 pt-4 shrink-0">
          {tabsVariant === "dropdown" ? (
            <div ref={dropdownRef} className="relative">
              <button
                type="button"
                onClick={() => setDropdownOpen(prev => !prev)}
                className="flex items-center gap-1.5 text-[0.8rem] font-semibold text-v3-dark px-3 py-1.5 rounded-[10px] border border-v3-border hover:bg-v3-dim-white transition-colors"
              >
                {activeTabLabel}
                <ChevronDown className={cn("w-3.5 h-3.5 text-v3-text-muted transition-transform", dropdownOpen && "rotate-180")} />
              </button>
              {dropdownOpen && (
                <div className="absolute top-full left-0 z-50 mt-1 min-w-[140px] max-h-[240px] overflow-y-auto rounded-[14px] border border-v3-border bg-white shadow-v3 py-1 animate-in fade-in-0 zoom-in-95">
                  {(tabs ?? []).map((tab) => (
                    <button
                      type="button"
                      key={tab.value}
                      onClick={() => { onTabChange?.(tab.value); setDropdownOpen(false); }}
                      className={cn(
                        "w-full text-left text-[0.8rem] px-4 py-2 transition-colors",
                        activeTab === tab.value
                          ? "text-v3-primary font-semibold bg-v3-primary-light"
                          : "text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-text"
                      )}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex gap-1">
              {(tabs ?? []).map((tab) => (
                <button
                  type="button"
                  key={tab.value}
                  onClick={() => onTabChange?.(tab.value)}
                  className={`text-[0.8rem] pb-2 px-3 transition-colors ${activeTab === tab.value
                    ? "text-v3-primary font-semibold border-b-2 tab-active-underline"
                    : "text-v3-text-muted hover:text-v3-text"
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
          {hasSearch && (
            <ExpandableSearch
              value={searchValue!}
              onChange={onSearchChange!}
              placeholder={searchPlaceholder}
              className={tabsVariant === "inline" ? "pb-2" : undefined}
            />
          )}
        </div>
      )}

      <div data-component="list-panel-content" className="overflow-y-auto min-h-0 flex-1 px-6 pt-6">
        {showContentSkeleton ? contentSkeleton : children}
        <div className="sticky bottom-0 h-6 bg-white shrink-0" />
      </div>
    </div>
  );
}
