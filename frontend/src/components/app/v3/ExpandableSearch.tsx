"use client";

import { useState, useRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExpandableSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  expandedWidth?: string;
  className?: string;
  disabled?: boolean;
  overlay?: boolean;
  openLabel?: string;
  closeLabel?: string;
}

export function ExpandableSearch({
  value,
  onChange,
  placeholder = "검색...",
  expandedWidth = "w-20",
  className,
  disabled = false,
  overlay = false,
  openLabel = "검색 열기",
  closeLabel = "검색 닫기",
}: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    if (disabled) return;
    setExpanded((prev) => {
      if (!prev) setTimeout(() => inputRef.current?.focus(), 50);
      else onChange("");
      return !prev;
    });
  };

  const handleBlur = () => {
    if (!value) setExpanded(false);
  };

  if (overlay) {
    return (
      <div
        data-component="expandable-search"
        className={cn("relative z-20 flex h-[calc(40px*var(--v3-ui-scale,1))] w-[calc(32px*var(--v3-ui-scale,1))] shrink-0 items-start justify-end overflow-visible", className)}
      >
        <div
          data-component="expandable-search-overlay"
          className={cn(
            "absolute right-0 top-0 flex h-[calc(40px*var(--v3-ui-scale,1))] items-start justify-start rounded-[12px] bg-transparent transition-[width,background] duration-200",
            expanded
              ? cn(expandedWidth, "bg-[linear-gradient(to_right,rgb(255_255_255_/_0)_0%,rgb(255_255_255)_10%,rgb(255_255_255)_100%)]")
              : "w-[calc(32px*var(--v3-ui-scale,1))]"
          )}
        >
          <button
            type="button"
            onClick={handleToggle}
            onMouseDown={(event) => event.preventDefault()}
            disabled={disabled}
            aria-label={expanded ? closeLabel : openLabel}
            className={cn(
              "flex h-[calc(32px*var(--v3-ui-scale,1))] w-[calc(32px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[10px] transition-transform duration-200 hover:bg-v3-dim-white",
              disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
            )}
          >
            <Search className="h-[calc(18px*var(--v3-ui-scale,1))] w-[calc(18px*var(--v3-ui-scale,1))] text-v3-text-muted" />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={handleBlur}
            disabled={disabled}
            className={cn(
              "h-[calc(32px*var(--v3-ui-scale,1))] min-w-0 flex-1 border-0 bg-transparent text-[calc(12.8px*var(--v3-ui-scale,1))] text-v3-dark shadow-none outline-none caret-v3-primary transition-[opacity,padding] duration-200 focus:outline-none focus:ring-0",
              expanded ? "px-[calc(8px*var(--v3-ui-scale,1))] opacity-100" : "w-0 px-0 opacity-0 pointer-events-none",
              disabled && "cursor-not-allowed text-v3-text-muted",
            )}
          />
        </div>
      </div>
    );
  }

  return (
    <div data-component="expandable-search" className={cn("flex items-center gap-[calc(6px*var(--v3-ui-scale,1))]", className)}>
      <button
        type="button"
        onClick={handleToggle}
        onMouseDown={(event) => event.preventDefault()}
        disabled={disabled}
        aria-label={expanded ? closeLabel : openLabel}
        className={cn(
          "flex h-[calc(32px*var(--v3-ui-scale,1))] w-[calc(32px*var(--v3-ui-scale,1))] items-center justify-center rounded-[10px] hover:bg-v3-dim-white",
          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
      >
        <Search className={expanded ? "hidden" : "h-[calc(18px*var(--v3-ui-scale,1))] w-[calc(18px*var(--v3-ui-scale,1))] text-v3-text-muted"} />
      </button>
      <input
        ref={inputRef}
        type="text"
        placeholder={expanded ? placeholder : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        disabled={disabled}
        className={cn(
          "border-0 bg-transparent text-[calc(12.8px*var(--v3-ui-scale,1))] text-v3-dark shadow-none outline-none caret-v3-primary placeholder:text-v3-text-muted/50 focus:outline-none focus:ring-0",
          expanded ? expandedWidth : "w-0",
          disabled && "cursor-not-allowed text-v3-text-muted",
        )}
      />
    </div>
  );
}
