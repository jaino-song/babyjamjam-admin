"use client";

import React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatMiniProps {
  /** Caller-context canonical value. StatsBar passes `${base}_stat-mini-N`. */
  "data-component": string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  value: string | number;
  label: string;
  colorIndex?: number;
  animationDelay?: React.CSSProperties["animationDelay"];
  isLoading?: boolean;
  counter?: string;
  tone?: "primary" | "orange" | "green" | "burgundy";
  urgent?: boolean;
  variant?: "default" | "compact";
}

const colorVariants = [
  { bg: "bg-primary-light", text: "text-primary" },
  { bg: "bg-orange-light", text: "text-orange" },
  { bg: "bg-green-light", text: "text-green" },
  { bg: "bg-burgundy-light", text: "text-burgundy" },
] as const;

const toneVariants = {
  primary: colorVariants[0],
  orange: colorVariants[1],
  green: colorVariants[2],
  burgundy: colorVariants[3],
} as const;

export function StatMini({
  "data-component": dataComponent,
  icon: Icon,
  value,
  label,
  colorIndex = 0,
  animationDelay,
  isLoading = false,
  counter = "",
  tone,
  urgent = false,
  variant = "default",
}: StatMiniProps) {
  const colorVariant = tone
    ? toneVariants[tone]
    : colorVariants[colorIndex % colorVariants.length];
  const animationStyle = animationDelay ? { animationDelay } : undefined;

  if (variant === "compact") {
    return (
      <div
        data-component={dataComponent}
        data-slot="stat-mini"
        className={cn(
          "mini-stat",
          !isLoading && "animate-v3-pop-up",
          isLoading && "mini-stat-skeleton",
        )}
        style={animationStyle}
      >
        {isLoading ? (
          <>
            <Skeleton data-slot="stat-mini-icon" className="mini-stat-icon bg-surface" />
            <div data-slot="stat-mini-skeleton-text" className="mini-stat-skeleton-text">
              <Skeleton
                data-slot="stat-mini-value"
                className="mini-stat-skeleton-num bg-surface"
              />
              <Skeleton
                data-slot="stat-mini-label"
                className="mini-stat-skeleton-label bg-surface"
              />
            </div>
          </>
        ) : (
          <>
            <div
              data-component={`${dataComponent}_icon`}
              data-slot="stat-mini-icon"
              className={`mini-stat-icon ${colorVariant.bg} ${colorVariant.text}`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </div>
            <div data-slot="stat-mini-content">
              <div
                data-slot="stat-mini-value"
                className={cn("mini-stat-num", urgent && "urgent")}
              >
                {value}
              </div>
              <div data-slot="stat-mini-label" className="mini-stat-label">
                {label}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
      data-component={dataComponent}
      data-slot="stat-mini"
      className={cn(
        "flex flex-1 items-center justify-start gap-4 rounded-2xl bg-white p-4 shadow-v3 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.33,1,0.68,1)] will-change-transform hover:-translate-y-1.5 hover:shadow-v3-hover",
        // Component-level animation so stats behave identically across pages.
        "animate-v3-pop-up"
      )}
      style={animationStyle}
    >
      <div
        data-component={`${dataComponent}_icon`}
        className={cn(
          "w-12 h-12 rounded-2xl flex items-center justify-center",
          isLoading ? "bg-surface" : colorVariant.bg
        )}
      >
        {isLoading ? (
          <Skeleton className="w-6 h-6 rounded-2xl bg-white/70" />
        ) : (
          <Icon className={`w-6 h-6 ${colorVariant.text}`} />
        )}
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-[29px] w-16 bg-surface" />
          <Skeleton className="h-3 w-20 bg-surface" />
        </div>
      ) : (
        <div>
          <span className="flex items-center gap-2">
            <p className="text-2xl font-bold text-dark">{value}</p>
            <p className="text-[0.7rem] text-text-muted self-end mb-1">{counter}</p>
          </span>
          <p className="text-[0.7rem] text-text-muted">{label}</p>
        </div>
      )}
    </div>
  );
}
