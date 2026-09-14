"use client";

import React from "react";
import { StatMini } from "./StatMini";

export interface StatsBarItem {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  value: string | number;
  label: string;
  counter?: string;
  colorIndex?: number;
  tone?: "primary" | "orange" | "green" | "burgundy";
  urgent?: boolean;
}

interface StatsBarProps {
  /** Caller-context canonical base, e.g. `mobile_admin_feedback_stats`. */
  "data-component": string;
  items: readonly StatsBarItem[];
  isLoading?: boolean;
  variant?: "default" | "compact";
}

export function StatsBar({
  "data-component": dataComponent,
  items,
  isLoading = false,
  variant = "default",
}: StatsBarProps) {
  return (
    <div
      data-component={dataComponent}
      data-slot="stats-grid"
      className={
        variant === "compact"
          ? "stats-grid"
          : "grid grid-cols-2 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2"
      }
    >
      {items.map((item, idx) => (
        <StatMini
          data-component={`${dataComponent}_stat-mini-${idx + 1}`}
          key={item.label}
          icon={item.icon}
          value={item.value}
          label={item.label}
          counter={item.counter}
          colorIndex={item.colorIndex ?? idx}
          tone={item.tone}
          urgent={item.urgent}
          animationDelay={`${idx * 0.08}s`}
          isLoading={isLoading}
          variant={variant}
        />
      ))}
    </div>
  );
}
