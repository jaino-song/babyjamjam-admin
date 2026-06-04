"use client";

import "./redesign.css";

import type { ReactNode } from "react";

import type { ContractRow } from "./mockup-data";
import { ContractList, ListCard } from "./primitives";

export interface ContractsRedesignFilter {
  label: string;
  count: string;
  active?: boolean;
}

export interface ContractsRedesignProps {
  sections: Array<{ title: string; rows: ContractRow[] }>;
  filters: ContractsRedesignFilter[];
  total: number;
  actionLabel?: string;
  actionHref?: string;
  emptyMessage?: ReactNode;
}

export function ContractsRedesign({
  sections,
  filters,
  total,
  actionLabel = "계약 작성",
  actionHref = "/contracts/new",
  emptyMessage,
}: ContractsRedesignProps) {
  const hasRows = sections.some((s) => s.rows.length > 0);
  return (
    <section data-component="contracts" className="flex h-full min-h-0 flex-col">
      <div className="shell-content" data-component="mobile-contracts-content">
        <ListCard
          title="계약서"
          count={`${total}건`}
          actionLabel={actionLabel}
          actionHref={actionHref}
          filters={filters}
        >
          {hasRows ? (
            <ContractList
              sections={sections}
              rowStyle={(idx) => ({ animationDelay: `${Math.min(idx, 4) * 40}ms` })}
            />
          ) : (
            <div
              data-component="mobile-contracts-empty"
              className="px-4 py-12 text-center text-[0.78rem] text-v3-text-muted"
            >
              {emptyMessage ?? "조건에 맞는 계약이 없습니다."}
            </div>
          )}
        </ListCard>
      </div>
    </section>
  );
}
