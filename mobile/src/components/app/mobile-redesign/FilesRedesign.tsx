"use client";

import "./redesign.css";

import { Search } from "lucide-react";
import type { ReactNode } from "react";

import type { ContractRow } from "./mockup-data";
import { ContractList, ListCard } from "./primitives";

export interface FilesRedesignFilter {
  label: string;
  count: string;
  active?: boolean;
}

export interface FilesRedesignProps {
  sections: Array<{ title: string; rows: ContractRow[] }>;
  filters: FilesRedesignFilter[];
  total: number;
  searchValue?: string;
  onSearchChange?: (next: string) => void;
  searchPlaceholder?: string;
  actionLabel?: string;
  actionHref?: string;
  emptyMessage?: ReactNode;
}

export function FilesRedesign({
  sections,
  filters,
  total,
  searchValue,
  onSearchChange,
  searchPlaceholder = "파일명, 설명, 태그 검색",
  actionLabel = "+ 업로드",
  actionHref = "/files/upload",
  emptyMessage,
}: FilesRedesignProps) {
  const hasRows = sections.some((s) => s.rows.length > 0);
  return (
    <section data-component="files" className="flex h-full min-h-0 flex-col">
      <div className="shell-content" data-component="mobile-files-content">
        <ListCard
          title="파일"
          count={`${total}건`}
          actionLabel={actionLabel}
          actionHref={actionHref}
          beforeFilters={
            <div className="search-bar" data-component="mobile-files-search">
              <Search size={14} strokeWidth={2.5} />
              <input
                aria-label="파일 검색"
                placeholder={searchPlaceholder}
                value={searchValue ?? ""}
                onChange={(e) => onSearchChange?.(e.target.value)}
              />
            </div>
          }
          filters={filters}
        >
          {hasRows ? (
            <ContractList sections={sections} />
          ) : (
            <div
              data-component="mobile-files-empty"
              className="px-4 py-12 text-center text-[0.78rem] text-v3-text-muted"
            >
              {emptyMessage ?? "조건에 맞는 파일이 없습니다."}
            </div>
          )}
        </ListCard>
      </div>
    </section>
  );
}
