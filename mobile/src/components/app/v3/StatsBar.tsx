"use client";

import React from "react";
import { StatMini } from "./StatMini";

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
  name?: string;
}

export function StatsBar({ items, isLoading = false, name = "stats" }: StatsBarProps) {
  return (
    <div
      data-component={`${name}-stats`}
      className="grid grid-cols-2 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2"
    >
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
        />
      ))}
    </div>
  );
}
