"use client";

import "./redesign.css";

import { Search } from "lucide-react";
import type { ReactNode } from "react";

import type { SectionRows } from "./mockup-data";
import { ListCard, SectionedList } from "./primitives";

export interface EmployeesRedesignFilter {
  label: string;
  count: string;
  active?: boolean;
}

export interface EmployeesRedesignProps {
  sections: SectionRows[];
  filters: EmployeesRedesignFilter[];
  total: number;
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  searchPlaceholder?: string;
  actionHref?: string;
  emptyMessage?: ReactNode;
}

export function EmployeesRedesign({
  sections,
  filters,
  total,
  searchValue,
  onSearchChange,
  searchPlaceholder = "이름, 근무 지역 검색",
  actionHref = "/employees/new",
  emptyMessage,
}: EmployeesRedesignProps) {
  const hasRows = sections.some((s) => s.rows.length > 0);
  return (
    <section data-component="employees" className="flex h-full min-h-0 flex-col">
      <div className="shell-content" data-component="mobile-employees-content">
        <ListCard
          title="제공인력"
          count={`${total}명`}
          actionLabel="+ 추가"
          actionHref={actionHref}
          beforeFilters={
            <div className="search-bar" data-component="mobile-employees-search">
              <Search size={14} strokeWidth={2.5} />
              <input
                aria-label="제공인력 검색"
                placeholder={searchPlaceholder}
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange?.(e.target.value)}
              />
            </div>
          }
          filters={filters}
        >
          {hasRows ? (
            <SectionedList sections={sections} />
          ) : (
            <div
              data-component="mobile-employees-empty"
              className="px-4 py-12 text-center text-[0.78rem] text-v3-text-muted"
            >
              {emptyMessage ?? "조건에 맞는 제공인력이 없습니다."}
            </div>
          )}
        </ListCard>
      </div>
    </section>
  );
}
