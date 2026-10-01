"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";

interface FilterOption {
  label: string;
  value: string;
}

interface SearchFilterBarProps {
  /** Caller-context canonical value for the bar root. */
  "data-component"?: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  filterOptions: FilterOption[];
  filterValue: string;
  onFilterChange: (value: string) => void;
  filterLabel?: string;
}

export function SearchFilterBar({
  "data-component": dataComponent,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filterOptions,
  filterValue,
  onFilterChange,
  filterLabel = "필터",
}: SearchFilterBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activeOption = filterOptions.find((o) => o.value === filterValue);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div data-component={dataComponent} data-slot="search-filter-bar" className="flex items-center gap-3 rounded-2xl bg-white px-5 py-3 shadow-v3 border border-border transition-all duration-200 focus-within:shadow-v3-hover animate-v3-slide-up">
      <Search size={18} className="text-text-muted shrink-0" />
      <Input
        type="text"
        placeholder={searchPlaceholder}
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        className="h-auto min-w-0 flex-1 border-none bg-transparent p-0 text-[0.85rem] outline-none placeholder:text-text-muted focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      <div className="h-5 w-px bg-border shrink-0" />

      <div ref={dropdownRef} className="relative shrink-0">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-[0.8rem] font-medium text-text hover:text-primary transition-colors whitespace-nowrap"
        >
          <span className={activeOption?.value !== filterOptions[0]?.value ? "text-primary" : ""}>
            {activeOption?.label || filterLabel}
          </span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-v3-hover border border-border py-1.5 z-50 animate-v3-pop-in">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onFilterChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 py-2 text-[0.8rem] transition-colors ${
                  option.value === filterValue
                    ? "text-primary font-semibold bg-primary-light"
                    : "text-text hover:bg-surface"
                }`}
              >
                <span>{option.label}</span>
                {option.value === filterValue && <Check size={14} className="text-primary" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
