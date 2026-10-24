"use client";

import React from "react";
import {
  DocumentJobsStatMini,
  useDocumentJobsStatVisible,
  type DocumentJobsStatMode,
} from "@/components/app/contracts/DocumentJobsStatMini";
import { StatMini, type StatMiniDensity } from "./StatMini";

export interface StatsBarItem {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  counter?: string;
  colorIndex?: number;
}

interface StatsBarProps {
  items: readonly StatsBarItem[];
  isLoading?: boolean;
  density?: StatMiniDensity;
  name: string;
  /**
   * Adds the app-wide "전자문서 처리중" card as the first slot. "always" keeps it at 0,
   * "whenActive" shows it only while there are active jobs or unresolved failures.
   */
  showDocumentJobs?: DocumentJobsStatMode;
}

export function StatsBar({
  items,
  isLoading = false,
  density = "default",
  name,
  showDocumentJobs,
}: StatsBarProps) {
  const documentJobsVisible = useDocumentJobsStatVisible(showDocumentJobs);

  // No items and no jobs card would leave an empty flex row (and its gap) on the page.
  if (items.length === 0 && !documentJobsVisible) return null;

  return (
    <div data-component={`${name}_stats`} className="flex flex-wrap gap-[calc(16px*var(--glint-ui-scale,1))]">
      {showDocumentJobs ? (
        <DocumentJobsStatMini mode={showDocumentJobs} density={density} name={name} />
      ) : null}
      {items.map((item, idx) => (
        <StatMini
          key={item.label}
          icon={item.icon}
          value={item.value}
          label={item.label}
          counter={item.counter}
          colorIndex={item.colorIndex ?? idx}
          animationDelay={`${idx * 0.08}s`}
          isLoading={isLoading}
          density={density}
        />
      ))}
    </div>
  );
}
