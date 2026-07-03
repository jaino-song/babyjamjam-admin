"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExpandableSearch } from "./ExpandableSearch";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useScrollActivity } from "./useScrollActivity";

interface TabItem {
  label: string;
  value: string;
  activeClassName?: string;
  indicatorClassName?: string;
}

interface ListPanelProps {
  title: string;
  subtitle?: string;
  /** Optional avatar element rendered to the left of the title group */
  avatar?: React.ReactNode;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  tabsVariant?: "inline" | "dropdown";
  headerPadding?: "auto" | "compact" | "default";
  overlay?: React.ReactNode;
  /** Empty state rendered as overlay (centered in full panel height) */
  emptyState?: React.ReactNode;
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
  avatar,
  tabs,
  activeTab,
  onTabChange,
  tabsVariant = "inline",
  headerPadding = "auto",
  overlay,
  emptyState,
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
      ? `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--v3-ui-scale,1))] shrink-0`
      : headerPadding === "compact"
        ? `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--v3-ui-scale,1))] pb-0 shrink-0`
        : showControls
          ? `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--v3-ui-scale,1))] pb-0 shrink-0`
          : `flex ${headerAlignmentClass} justify-between p-[calc(24px*var(--v3-ui-scale,1))] shrink-0`;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { isScrollActive, handleScroll } = useScrollActivity();

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
    <div data-component="list-panel" className="relative flex h-full min-h-0 flex-1 self-stretch flex-col overflow-hidden rounded-[28px] bg-white shadow-v3">
      <div data-component="list-panel-top-area" className="shrink-0">
        <div data-component="list-panel-header" className={headerClassName}>
          <div className="flex min-w-0 items-center gap-[calc(16px*var(--v3-ui-scale,1))]">
            {avatar}
            <PanelTitleGroup
              component="list-panel"
              title={title}
              subtitle={subtitle}
              titleClassName="text-[calc(18px*var(--v3-ui-scale,1))]"
            />
          </div>
          {headerActions && (
            <div
              data-component="list-panel-header-actions"
              className={cn(disabled && "pointer-events-none opacity-40")}
            >
              {headerActions}
            </div>
          )}
        </div>

        {subHeader && <div data-component="list-panel-sub-header" className="shrink-0 px-[calc(24px*var(--v3-ui-scale,1))] pt-[calc(12px*var(--v3-ui-scale,1))]">{subHeader}</div>}

        {showControls && (
          <div
            data-component="list-panel-tabs"
            className={cn(
              "relative flex min-h-[calc(52px*var(--v3-ui-scale,1))] shrink-0 items-center gap-[calc(12px*var(--v3-ui-scale,1))] overflow-visible px-[calc(24px*var(--v3-ui-scale,1))] pt-[calc(16px*var(--v3-ui-scale,1))] [container-type:inline-size]",
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
                      "flex items-center gap-[calc(6px*var(--v3-ui-scale,1))] rounded-[10px] border border-v3-border px-[calc(12px*var(--v3-ui-scale,1))] py-[calc(6px*var(--v3-ui-scale,1))] text-[calc(12px*var(--v3-ui-scale,1))] font-semibold text-v3-dark transition-colors hover:bg-v3-dim-white",
                      disabled && "cursor-not-allowed opacity-60 hover:bg-white",
                    )}
                  >
                    {activeTabLabel}
                    <ChevronDown className={cn("h-[calc(14px*var(--v3-ui-scale,1))] w-[calc(14px*var(--v3-ui-scale,1))] text-v3-text-muted transition-transform", dropdownOpen && "rotate-180")} />
                  </button>
                  {dropdownOpen && !disabled && (
                    <div className="animate-in fade-in-0 zoom-in-95 absolute left-0 top-full z-50 mt-[calc(4px*var(--v3-ui-scale,1))] max-h-[calc(240px*var(--v3-ui-scale,1))] min-w-[calc(140px*var(--v3-ui-scale,1))] overflow-y-auto rounded-[14px] border border-v3-border bg-white py-[calc(4px*var(--v3-ui-scale,1))] shadow-v3">
                      {(tabs ?? []).map((tab) => (
                        <button
                          type="button"
                          key={tab.value}
                          onClick={() => { onTabChange?.(tab.value); setDropdownOpen(false); }}
                          className={cn(
                            "w-full px-[calc(16px*var(--v3-ui-scale,1))] py-[calc(8px*var(--v3-ui-scale,1))] text-left text-[calc(12px*var(--v3-ui-scale,1))] transition-colors",
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
                <div
                  data-component="list-panel-tab-scroll"
                  className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                >
                  <div className="flex w-max gap-[calc(4px*var(--v3-ui-scale,1))]">
                    {(tabs ?? []).map((tab) => (
                      <button
                        data-component="list-panel-tab-button"
                        type="button"
                        key={tab.value}
                        disabled={disabled}
                        onClick={() => onTabChange?.(tab.value)}
                        className={cn(
                          "relative shrink-0 px-[calc(12px*var(--v3-ui-scale,1))] pb-[calc(8px*var(--v3-ui-scale,1))] text-[calc(12px*var(--v3-ui-scale,1))] transition-colors",
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
                </div>
              )
            ) : null}
            {hasSearch && (
              <ExpandableSearch
                value={searchValue!}
                onChange={onSearchChange!}
                placeholder={searchPlaceholder}
                className={tabsVariant === "inline" ? "pb-[calc(8px*var(--v3-ui-scale,1))]" : undefined}
                disabled={disabled}
                overlay={tabsVariant === "inline"}
              />
            )}
          </div>
        )}
      </div>
      {overlay ? (
        <div
          data-component="list-panel-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex -translate-y-[calc(12px*var(--v3-ui-scale,1))] items-center justify-center p-[calc(24px*var(--v3-ui-scale,1))]"
        >
          {overlay}
        </div>
      ) : null}

      {emptyState ? (
        <div
          data-component="list-panel-empty-state"
          className="absolute inset-0 z-10 flex items-center justify-center p-[calc(24px*var(--v3-ui-scale,1))]"
        >
          {emptyState}
        </div>
      ) : (
        <div
          data-component="list-panel-content"
          className="scrollbar-on-scroll relative flex min-h-0 flex-1 flex-col overflow-y-auto px-[calc(24px*var(--v3-ui-scale,1))] pt-[calc(12px*var(--v3-ui-scale,1))]"
          data-scroll-active={isScrollActive ? "true" : "false"}
          onScroll={handleScroll}
        >
          {showContentSkeleton ? contentSkeleton : children}
          <div className="sticky bottom-0 h-[calc(24px*var(--v3-ui-scale,1))] shrink-0 bg-white" />
        </div>
      )}
      {disabled ? (
        <div
          data-component="list-panel-disabled-overlay"
          aria-hidden="true"
          className="absolute inset-0 z-20 bg-slate-200/70 backdrop-blur-[1.5px]"
        >
          {disabledOverlay ? (
            <div className="flex h-full items-center justify-center p-[calc(24px*var(--v3-ui-scale,1))]">{disabledOverlay}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
