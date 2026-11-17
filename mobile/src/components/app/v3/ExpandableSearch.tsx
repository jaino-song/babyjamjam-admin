"use client";

import { useState, useRef, type FocusEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

interface ExpandableSearchProps {
  /** Caller-context canonical value. Composites pass `${base}_search`. */
  "data-component"?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  expandedWidth?: string;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  openLabel?: string;
  closeLabel?: string;
  inputLabel?: string;
}

export function ExpandableSearch({
  "data-component": dataComponent,
  value,
  onChange,
  placeholder = "검색...",
  expandedWidth = "w-full",
  onExpandedChange,
  className,
  openLabel = "검색 열기",
  closeLabel = "검색 닫기",
  inputLabel = "검색어",
}: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const changeExpanded = (nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };

  const handleToggle = () => {
    if (!expanded) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      onChange("");
    }
    changeExpanded(!expanded);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (event.currentTarget.parentElement?.contains(event.relatedTarget)) return;
    if (!value) changeExpanded(false);
  };

  return (
    <div data-component={dataComponent} data-slot="expandable-search" data-source-component="ExpandableSearch" className={cn("flex items-center gap-1.5", expanded && "min-w-0 flex-1", className)}>
      <button
        data-component={dataComponent ? `${dataComponent}_toggle` : undefined}
        type="button"
        onClick={handleToggle}
        aria-label={expanded ? closeLabel : openLabel}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl hover:bg-v3-dim-white after:absolute after:-inset-1.5 after:content-['']"
      >
        <Search className={expanded ? "hidden" : "w-[18px] h-[18px] text-v3-text-muted"} />
      </button>
      <Input
        data-component={dataComponent ? `${dataComponent}_input` : undefined}
        ref={inputRef}
        type="text"
        aria-label={inputLabel}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        className={cn(
          "border-0 bg-v3-dim-white text-v3-dark caret-v3-primary placeholder:text-v3-text-muted focus-visible:ring-0 focus-visible:ring-offset-0",
          expanded ? cn("min-w-0 flex-1", expandedWidth) : "h-0 w-0 rounded-none p-0"
        )}
      />
    </div>
  );
}
