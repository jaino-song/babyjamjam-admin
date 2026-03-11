"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExpandableSearch } from "./ExpandableSearch";
import { PanelTitleGroup } from "./PanelTitleGroup";

interface TabItem {
  label: string;
  value: string;
  activeClassName?: string;
  indicatorClassName?: string;
}

interface ListPanelProps {
  title: string;
  subtitle?: string;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  tabsVariant?: "inline" | "dropdown";
  headerPadding?: "auto" | "compact" | "default";
  overlay?: React.ReactNode;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  isLoading?: boolean;
  isContentLoading?: boolean;
  contentSkeleton?: React.ReactNode;
  subHeader?: React.ReactNode;
  disabled?: boolean;
  disabledOverlay?: React.ReactNode;
}

export function ListPanel({
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  tabsVariant = "inline",
  headerPadding = "auto",
  overlay,
  children,
  headerActions,
  searchValue,
  onSearchChange,
  searchPlaceholder = "검색...",
  isLoading = false,
  isContentLoading = false,
  contentSkeleton,
  subHeader,
  disabled = false,
  disabledOverlay,
}: ListPanelProps) {
  const showTabs = tabs && tabs.length > 0;
  const hasSearch = searchValue !== undefined && !!onSearchChange;
  const showControls = showTabs || hasSearch;
  const showContentSkeleton = (isLoading || isContentLoading) && contentSkeleton;
  const headerAlignmentClass = subtitle ? "items-start" : "items-center";
  const headerClassName =
    headerPadding === "default"
      ? `flex ${headerAlignmentClass} justify-between p-6 shrink-0`
      : headerPadding === "compact"
        ? `flex ${headerAlignmentClass} justify-between p-6 pb-0 shrink-0`
        : showControls
          ? `flex ${headerAlignmentClass} justify-between p-6 pb-0 shrink-0`
          : `flex ${headerAlignmentClass} justify-between p-6 shrink-0`;
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
    <div data-component="list-panel" className="relative bg-white rounded-[28px] shadow-v3 flex flex-col flex-1 self-stretch overflow-hidden h-full min-h-0">
      <div data-component="list-panel-top-area" className="shrink-0">
        <div data-component="list-panel-header" className={headerClassName}>
          <PanelTitleGroup
            component="list-panel"
            title={title}
            subtitle={subtitle}
            titleClassName="text-xl"
          />
          {headerActions && (
            <div
              data-component="list-panel-header-actions"
              className={cn(disabled && "pointer-events-none opacity-40")}
            >
              {headerActions}
            </div>
          )}
        </div>

        {subHeader && <div data-component="list-panel-sub-header" className="px-6 pt-3 shrink-0">{subHeader}</div>}

        {showControls && (
          <div
            data-component="list-panel-tabs"
            className={cn(
              "flex items-center px-6 pt-4 shrink-0",
              showTabs ? "justify-between" : "justify-end",
            )}
          >
            {showTabs ? (
              tabsVariant === "dropdown" ? (
                <div ref={dropdownRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      if (!disabled) {
                        setDropdownOpen(prev => !prev);
                      }
                    }}
                    disabled={disabled}
                    className={cn(
                      "flex items-center gap-1.5 text-[0.8rem] font-semibold text-v3-dark px-3 py-1.5 rounded-[10px] border border-v3-border hover:bg-v3-dim-white transition-colors",
                      disabled && "cursor-not-allowed opacity-60 hover:bg-white",
                    )}
                  >
                    {activeTabLabel}
                    <ChevronDown className={cn("w-3.5 h-3.5 text-v3-text-muted transition-transform", dropdownOpen && "rotate-180")} />
                  </button>
                  {dropdownOpen && !disabled && (
                    <div className="absolute top-full left-0 z-50 mt-1 min-w-[140px] max-h-[240px] overflow-y-auto rounded-[14px] border border-v3-border bg-white shadow-v3 py-1 animate-in fade-in-0 zoom-in-95">
                      {(tabs ?? []).map((tab) => (
                        <button
                          type="button"
                          key={tab.value}
                          onClick={() => { onTabChange?.(tab.value); setDropdownOpen(false); }}
                          className={cn(
                            "w-full text-left text-[0.8rem] px-4 py-2 transition-colors",
                            activeTab === tab.value
                              ? cn("font-semibold bg-v3-primary-light", tab.activeClassName ?? "text-v3-primary")
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
                      data-component="list-panel-tab-button"
                      type="button"
                      key={tab.value}
                      disabled={disabled}
                      onClick={() => onTabChange?.(tab.value)}
                      className={cn(
                        "relative px-3 pb-2 text-[0.8rem] transition-colors",
                        activeTab === tab.value
                          ? cn("font-semibold", tab.activeClassName ?? "text-primary")
                          : "text-v3-text-muted hover:text-v3-text",
                        disabled && "cursor-not-allowed text-v3-text-muted/60 hover:text-v3-text-muted/60"
                      )}
                    >
                      {tab.label}
                      {activeTab === tab.value ? (
                        <span
                          data-component="list-panel-tab-indicator"
                          className={cn(
                            "absolute bottom-0 left-0 h-0.5 w-full",
                            tab.indicatorClassName ?? "bg-primary"
                          )}
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
              )
            ) : null}
            {hasSearch && (
              <ExpandableSearch
                value={searchValue!}
                onChange={onSearchChange!}
                placeholder={searchPlaceholder}
                className={tabsVariant === "inline" && showTabs ? "pb-2" : undefined}
                disabled={disabled}
              />
            )}
          </div>
        )}
      </div>
      {overlay ? (
        <div
          data-component="list-panel-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 -translate-y-3"
        >
          {overlay}
        </div>
      ) : null}

      <div data-component="list-panel-content" className="relative overflow-y-auto min-h-0 flex-1 px-6 pt-6 flex flex-col">
        {showContentSkeleton ? contentSkeleton : children}
        <div className="sticky bottom-0 h-6 bg-white shrink-0" />
      </div>
      {disabled ? (
        <div
          data-component="list-panel-disabled-overlay"
          aria-hidden="true"
          className="absolute inset-0 z-20 bg-slate-200/70 backdrop-blur-[1.5px]"
        >
          {disabledOverlay ? (
            <div className="flex h-full items-center justify-center p-6">{disabledOverlay}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
