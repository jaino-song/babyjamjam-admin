"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatMiniProps {
  icon: React.ComponentType<{ className?: string }>;
  value: string | number;
  label: string;
  colorIndex?: number;
  animationDelay?: React.CSSProperties["animationDelay"];
  isLoading?: boolean;
  counter?: string;
}

const colorVariants = [
  { bg: "bg-v3-primary-light", text: "text-v3-primary" },
  { bg: "bg-v3-orange-light", text: "text-v3-orange" },
  { bg: "bg-v3-green-light", text: "text-v3-green" },
  { bg: "bg-v3-burgundy-light", text: "text-v3-burgundy" },
] as const;

export function StatMini({
  icon: Icon,
  value,
  label,
  colorIndex = 0,
  animationDelay,
  isLoading = false,
  counter = "",
}: StatMiniProps) {
  const variant = colorVariants[colorIndex % colorVariants.length];
  const animationStyle = animationDelay ? { animationDelay } : undefined;

  return (
    <div
      data-component="stat-mini"
      className={cn(
        "w-44 bg-white rounded-[20px] shadow-v3 hover:shadow-v3-hover hover:-translate-y-1 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] p-4 will-change-transform flex gap-4 items-center justify-start",
        // Component-level animation so stats behave identically across pages.
        "animate-v3-pop-up"
      )}
      style={animationStyle}
    >
      <div
        data-component="stat-mini-icon"
        className={cn(
          "w-12 h-12 rounded-[14px] flex items-center justify-center",
          isLoading ? "bg-v3-dim-white" : variant.bg
        )}
      >
        {isLoading ? (
          <Skeleton className="w-6 h-6 rounded-md bg-white/70" />
        ) : (
          <Icon className={`w-6 h-6 ${variant.text}`} />
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-16 bg-v3-dim-white" />
          <Skeleton className="h-3 w-20 bg-v3-dim-white" />
        </div>
      ) : (
        <div>
          <span className="flex items-center gap-1">
            <p className="text-2xl font-bold text-v3-dark">{value}</p>
            <p className="text-[0.7rem] text-v3-text-muted self-end mb-1">{counter}</p>
          </span>
          <p className="text-[0.7rem] text-v3-text-muted">{label}</p>
        </div>
      )}
    </div>
  );
}
