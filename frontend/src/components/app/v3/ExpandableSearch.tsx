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
}

export function ExpandableSearch({
  value,
  onChange,
  placeholder = "검색...",
  expandedWidth = "w-20",
  className,
}: ExpandableSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleToggle = () => {
    setExpanded((prev) => {
      if (!prev) setTimeout(() => inputRef.current?.focus(), 50);
      else onChange("");
      return !prev;
    });
  };

  const handleBlur = () => {
    if (!value) setExpanded(false);
  };

  return (
    <div data-component="expandable-search" className={cn("flex items-center gap-1.5", className)}>
      <button
        onClick={handleToggle}
        className="w-8 h-8 rounded-[10px] flex items-center justify-center hover:bg-v3-dim-white"
      >
        <Search className={expanded ? "hidden" : "w-[18px] h-[18px] text-v3-text-muted"} />
      </button>
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        style={{ border: "none", outline: "none", boxShadow: "none" }}
        className={cn(
          "bg-transparent text-sm text-v3-dark caret-v3-primary placeholder:text-v3-text-muted/50",
          expanded ? expandedWidth : "w-0"
        )}
      />
    </div>
  );
}
