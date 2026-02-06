"use client";

import { Search } from "lucide-react";

interface SearchBoxProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

export function SearchBox({ placeholder, value, onChange }: SearchBoxProps) {
  return (
    <div className="group flex items-center gap-3 rounded-[50px] bg-white px-5 py-3 shadow-v3 border border-v3-border transition-all duration-200 focus-within:shadow-v3-hover focus-within:scale-[1.01]">
      <Search size={18} className="text-v3-text-muted shrink-0" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-[0.85rem] outline-none border-none placeholder:text-v3-text-muted"
      />
    </div>
  );
}
