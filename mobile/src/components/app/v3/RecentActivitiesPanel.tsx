"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/app/ui/status-badge";
import { cn } from "@/lib/utils";
import { AnimatedSlotList } from "./AnimatedSlotList";
import type { Client } from "@/lib/client/types";

export type ActionRequiredItem = {
  client: Client;
  reason: string;
  priority: number;
};

export interface RecentActivitiesPanelProps {
  title?: string;
  actionRequiredItems: ActionRequiredItem[];
  upcomingItems: Client[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedId?: number | null;
  onSelect: (client: Client) => void;
  hasMore?: boolean;
  viewAllHref?: string;
  viewAllLabel?: string;
  className?: string;
}

const SKELETON_ICON_BG = [
  "bg-v3-primary",
  "bg-[hsl(355,36%,45%)]",
  "bg-[hsl(34,100%,55%)]",
  "bg-[hsl(213,15%,50%)]",
];

const PRIORITY_COLORS: Record<
  number,
  { iconBg: string; badgeBg: string; badgeText: string; badgeBorder: string }
> = {
  1: {
    iconBg: "bg-[hsl(355,36%,45%)]",
    badgeBg: "bg-[hsl(355,40%,94%)]",
    badgeText: "text-[hsl(355,36%,45%)]",
    badgeBorder: "border-[hsla(355,36%,45%,0.20)]",
  },
  2: {
    iconBg: "bg-[hsl(34,100%,55%)]",
    badgeBg: "bg-[hsl(34,100%,94%)]",
    badgeText: "text-[hsl(34,80%,38%)]",
    badgeBorder: "border-[hsla(34,80%,38%,0.20)]",
  },
  3: {
    iconBg: "bg-v3-primary",
    badgeBg: "bg-[hsl(214,80%,95%)]",
    badgeText: "text-v3-primary",
    badgeBorder: "border-[hsla(214,100%,34%,0.20)]",
  },
};

const AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-[hsl(214,100%,34%)] to-[hsl(214,100%,28%)]",
  "bg-gradient-to-br from-[hsl(137,34%,31%)] to-[hsl(137,34%,25%)]",
  "bg-gradient-to-br from-[hsl(355,36%,45%)] to-[hsl(355,36%,38%)]",
  "bg-gradient-to-br from-[hsl(34,100%,55%)] to-[hsl(34,100%,45%)]",
  "bg-gradient-to-br from-[hsl(175,60%,40%)] to-[hsl(175,60%,30%)]",
  "bg-gradient-to-br from-[hsl(270,60%,55%)] to-[hsl(270,60%,45%)]",
];

function getAvatarGradient(name: string) {
  return AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length];
}

function getRelativeDate(dateStr: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "내일";
  return `${diffDays}일 후`;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="p-8 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-[hsl(355,40%,94%)] flex items-center justify-center">
        <AlertTriangle className="w-6 h-6 text-[hsl(355,36%,45%)]" />
      </div>
      <p className="text-[0.9rem] font-bold text-v3-dark">
        데이터를 불러올 수 없습니다
      </p>
      <p className="text-[0.73rem] text-v3-text-muted">
        네트워크 상태를 확인한 뒤 다시 시도해 주세요.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center justify-center rounded-2xl border border-[hsla(355,36%,45%,0.25)] bg-[hsl(355,40%,94%)] px-3 py-2 text-[0.73rem] font-bold text-[hsl(355,36%,45%)] transition hover:-translate-y-0.5"
      >
        다시 시도
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="p-8 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-v3-green-light flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-v3-green" />
      </div>
      <p className="text-[0.9rem] font-bold text-v3-dark">
        현재 조치가 필요한 항목이 없습니다
      </p>
      <p className="text-[0.73rem] text-v3-text-muted">
        새로운 요청이 접수되면 우선순위 순으로 표시됩니다.
      </p>
    </div>
  );
}

export function RecentActivitiesPanel({
  title = "최근 현황",
  actionRequiredItems,
  upcomingItems,
  isLoading,
  isError,
  onRetry,
  selectedId,
  onSelect,
  hasMore = false,
  viewAllHref = "/clients",
  viewAllLabel = "전체 고객 보기",
  className,
}: RecentActivitiesPanelProps) {
  const isEmpty =
    actionRequiredItems.length === 0 && upcomingItems.length === 0;

  return (
    <div
      className={cn(
        "bg-white rounded-2xl shadow-v3 flex flex-col overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between p-6 pb-4 border-v3-border">
        <h2 className="text-lg font-bold text-v3-dark">{title}</h2>
      </div>

      <div className="p-6 pt-0 space-y-5">
        {!isLoading && isError ? (
          <ErrorState onRetry={onRetry} />
        ) : !isLoading && isEmpty ? (
          <EmptyState />
        ) : (
          <>
            {(isLoading || actionRequiredItems.length > 0) && (
              <div className="space-y-0">
                <div className="flex items-center justify-between p-2">
                  {isLoading ? (
                    <>
                      <Skeleton className="h-3 w-14 bg-v3-dim-white" />
                      <Skeleton className="h-4 w-10 rounded-full bg-v3-dim-white" />
                    </>
                  ) : (
                    <>
                      <span className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-text-muted font-semibold">
                        조치 필요
                      </span>
                      <StatusPill variant="neutral" size="sm">
                        {actionRequiredItems.length}건
                      </StatusPill>
                    </>
                  )}
                </div>

                <AnimatedSlotList
                  items={actionRequiredItems}
                  isLoading={isLoading}
                  animate={isLoading}
                  loadingCount={3}
                  className="space-y-2"
                  itemDataComponent="dashboard-split-list-item"
                  onSlotClick={(item) => onSelect(item.client)}
                  slotClassName={({ item, isLoading: loading }) =>
                    cn(
                      "flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 bg-white border-2 border-transparent",
                      !loading && item && selectedId === item.client.id
                        ? "bg-v3-primary-light border-2 border-v3-primary"
                        : !loading && "cursor-pointer hover:bg-v3-primary-light/50 hover:border-v3-primary/30",
                    )
                  }
                  render={({ index, item, isLoading: loading }) => {
                    if (loading) {
                      const iconBgClass =
                        SKELETON_ICON_BG[index % SKELETON_ICON_BG.length]?.split(" ")[0] ?? "bg-v3-primary";
                      return (
                        <>
                          <div
                            className={cn(
                              "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0",
                              iconBgClass,
                            )}
                          >
                            <Skeleton className="w-4 h-4 rounded-2xl bg-white/70" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2">
                              <Skeleton className="h-4 w-24 bg-v3-dim-white" />
                              <Skeleton className="h-4 w-12 rounded-full bg-v3-dim-white" />
                            </div>
                            <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                          </div>
                        </>
                      );
                    }
                    if (!item) return null;
                    const colors =
                      PRIORITY_COLORS[item.priority] || PRIORITY_COLORS[3];
                    const badgeVariant =
                      item.priority === 1 ? "danger" : item.priority === 2 ? "warning" : "primary";

                    return (
                      <>
                        <div
                          className={cn(
                            "w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md",
                            colors.iconBg,
                          )}
                        >
                          {item.client.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                              {item.client.name}
                            </span>
                            <StatusPill variant={badgeVariant} size="sm">
                              {item.reason}
                            </StatusPill>
                          </div>
                          <p className="text-[0.7rem] text-v3-text-muted truncate">
                            {item.client.type || "일반"} ·{" "}
                            {item.client.primaryEmployee?.name || "-"}
                          </p>
                        </div>
                      </>
                    );
                  }}
                />
              </div>
            )}

            {(isLoading || upcomingItems.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-2">
                  {isLoading ? (
                    <>
                      <Skeleton className="h-3 w-14 bg-v3-dim-white" />
                      <Skeleton className="h-4 w-10 rounded-full bg-v3-dim-white" />
                    </>
                  ) : (
                    <>
                      <span className="text-[0.7rem] uppercase tracking-[0.1em] text-v3-text-muted font-semibold">
                        곧 시작
                      </span>
                      <StatusPill variant="neutral" size="sm">
                        {upcomingItems.length}건
                      </StatusPill>
                    </>
                  )}
                </div>

                <AnimatedSlotList
                  items={upcomingItems}
                  isLoading={isLoading}
                  animate={isLoading}
                  loadingCount={2}
                  className="space-y-2"
                  itemDataComponent="dashboard-split-list-item"
                  onSlotClick={(item) => onSelect(item)}
                  slotClassName={({ item, isLoading: loading }) =>
                    cn(
                      "flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 bg-white border-2 border-transparent",
                      !loading && item && selectedId === item.id
                        ? "bg-v3-primary-light border-2 border-v3-primary"
                        : !loading && "cursor-pointer hover:bg-v3-primary-light/50 hover:border-v3-primary/30",
                    )
                  }
                  render={({ index, item, isLoading: loading }) => {
                    if (loading) {
                      const iconBgClass =
                        SKELETON_ICON_BG[(3 + index) % SKELETON_ICON_BG.length]?.split(" ")[0] ?? "bg-v3-primary";
                      return (
                        <>
                          <div
                            className={cn(
                              "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0",
                              iconBgClass,
                            )}
                          >
                            <Skeleton className="w-4 h-4 rounded-2xl bg-white/70" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2">
                              <Skeleton className="h-4 w-24 bg-v3-dim-white" />
                              <Skeleton className="h-4 w-12 rounded-full bg-v3-dim-white" />
                            </div>
                            <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                          </div>
                        </>
                      );
                    }
                    if (!item) return null;

                    return (
                      <>
                        <div
                          className={cn(
                            "w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md",
                            getAvatarGradient(item.name),
                          )}
                        >
                          {item.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                              {item.name}
                            </span>
                            <StatusPill variant="primary" size="sm">
                              {item.type || "일반"}
                            </StatusPill>
                          </div>
                          <p className="text-[0.7rem] text-v3-text-muted truncate">
                            {item.primaryEmployee?.name || "-"} ·{" "}
                            {item.startDate
                              ? getRelativeDate(item.startDate)
                              : "-"}
                          </p>
                        </div>
                      </>
                    );
                  }}
                />
              </div>
            )}
          </>
        )}

        {hasMore && (
          <Link
            href={viewAllHref}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-v3-border bg-v3-dim-white px-3 py-[11px] text-[0.75rem] font-bold text-v3-primary transition hover:-translate-y-0.5 hover:border-v3-primary/30 hover:bg-v3-primary-light"
          >
            {viewAllLabel} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}
