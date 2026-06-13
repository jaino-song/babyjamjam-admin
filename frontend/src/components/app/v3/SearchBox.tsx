"use client";

import { ExpandableSearch } from "./ExpandableSearch";

interface SearchBoxProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchBox({ placeholder, value, onChange }: SearchBoxProps) {
  return (
    <div data-component="search-box" className="group flex items-center gap-3 rounded-[50px] bg-white px-5 py-3 shadow-v3 border border-v3-border transition-all duration-200 focus-within:shadow-v3-hover focus-within:scale-[1.01]">
      <ExpandableSearch
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        expandedWidth="flex-1"
        className="w-full"
      />
    </div>
  );
}
