"use client";

import "./redesign.css";

import { Search } from "lucide-react";
import type { ReactNode } from "react";

import type { SectionRows } from "./mockup-data";
import { ListCard, SectionedList } from "./primitives";

export interface ClientsRedesignFilter {
  label: string;
  count: string;
  active?: boolean;
}

export interface ClientsRedesignProps {
  sections: SectionRows[];
  filters: ClientsRedesignFilter[];
  total: number;
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  searchPlaceholder?: string;
  actionLabel?: string;
  actionHref?: string;
  emptyMessage?: ReactNode;
}

export function ClientsRedesign({
  sections,
  filters,
  total,
  searchValue,
  onSearchChange,
  searchPlaceholder = "고객 이름, 제공인력 검색",
  actionLabel = "+ 추가",
  actionHref = "/clients/new",
  emptyMessage,
}: ClientsRedesignProps) {
  const hasRows = sections.some((s) => s.rows.length > 0);

  return (
    <section data-component="clients" className="flex h-full min-h-0 flex-col">
      <div className="shell-content" data-component="mobile-clients-content">
        <ListCard
          title="고객"
          count={`${total}명`}
          actionLabel={actionLabel}
          actionHref={actionHref}
          beforeFilters={
            <div className="search-bar" data-component="mobile-clients-search">
              <Search size={14} strokeWidth={2.5} />
              <input
                aria-label="고객 검색"
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
              data-component="mobile-clients-empty"
              className="px-4 py-12 text-center text-[0.78rem] text-v3-text-muted"
            >
              {emptyMessage ?? "조건에 맞는 고객이 없습니다."}
            </div>
          )}
        </ListCard>
      </div>
    </section>
  );
}
