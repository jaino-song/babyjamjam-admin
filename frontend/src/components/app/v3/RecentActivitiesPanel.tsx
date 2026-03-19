"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/app/ui/status-badge";
import {
  type ActionRequiredReason,
  type ActionRequiredStatus,
} from "@/lib/client/action-required";
import { cn } from "@/lib/utils";
import { AnimatedSlotList } from "./AnimatedSlotList";
import { useScrollActivity } from "./useScrollActivity";
import type { Client } from "@/lib/client/types";

export type ActionRequiredItem = {
  client: Client;
  reason: ActionRequiredReason;
  priority: ActionRequiredStatus["priority"];
};

type RecentActivitiesPanelTab = "all" | "upcoming" | "actionRequired";

type RecentActivityListItem = {
  key: string;
  client: Client;
  actionReason?: ActionRequiredReason;
  actionPriority?: ActionRequiredStatus["priority"];
  isUpcoming: boolean;
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
  onLoadMore?: () => void;
  isFetchingMore?: boolean;
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

function isToday(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return target.getTime() === today.getTime();
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="p-8 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-[18px] bg-[hsl(355,40%,94%)] flex items-center justify-center">
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
        className="inline-flex items-center justify-center rounded-[12px] border border-[hsla(355,36%,45%,0.25)] bg-[hsl(355,40%,94%)] px-3 py-2 text-[0.73rem] font-bold text-[hsl(355,36%,45%)] transition hover:-translate-y-0.5"
      >
        다시 시도
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="p-8 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-[18px] bg-v3-green-light flex items-center justify-center">
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

function FilterEmptyState({ activeTab }: { activeTab: RecentActivitiesPanelTab }) {
  if (activeTab === "actionRequired") {
    return <EmptyState />;
  }

  if (activeTab === "upcoming") {
    return (
      <div className="p-8 text-center space-y-3">
        <div className="w-12 h-12 mx-auto rounded-[18px] bg-v3-primary-light flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-v3-primary" />
        </div>
        <p className="text-[0.9rem] font-bold text-v3-dark">
          곧 시작 예정인 고객이 없습니다
        </p>
        <p className="text-[0.73rem] text-v3-text-muted">
          7일 이내 시작 일정이 생기면 여기에 표시됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 text-center space-y-3">
      <div className="w-12 h-12 mx-auto rounded-[18px] bg-v3-green-light flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-v3-green" />
      </div>
      <p className="text-[0.9rem] font-bold text-v3-dark">
        표시할 최근 현황이 없습니다
      </p>
      <p className="text-[0.73rem] text-v3-text-muted">
        조치 필요 항목이나 시작 예정 고객이 생기면 여기에 표시됩니다.
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
  onLoadMore,
  isFetchingMore = false,
  viewAllHref = "/clients",
  viewAllLabel = "전체 고객 보기",
  className,
}: RecentActivitiesPanelProps) {
  const [activeTab, setActiveTab] = useState<RecentActivitiesPanelTab>("all");
  const { isScrollActive, handleScroll } = useScrollActivity();
  const isEmpty =
    actionRequiredItems.length === 0 && upcomingItems.length === 0;
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggeredRef = useRef(false);
  const tabs = useMemo(
    () =>
      [
        { value: "all", label: "전체" },
        { value: "upcoming", label: "곧 시작" },
        { value: "actionRequired", label: "조치 필요" },
      ] satisfies Array<{ value: RecentActivitiesPanelTab; label: string }>,
    []
  );

  const listItems = useMemo<RecentActivityListItem[]>(() => {
    const actionRequiredByClientId = new Map(
      actionRequiredItems.map((item) => [item.client.id, item] as const),
    );
    const normalizedUpcomingItems = upcomingItems
      .filter((item) => !item.startDate || !isToday(item.startDate))
      .map((item) => item);

    const toListItem = (
      client: Client,
      actionItem?: ActionRequiredItem,
      isUpcoming = false,
    ): RecentActivityListItem => ({
      key: `recent-${client.id}`,
      client,
      actionReason: actionItem?.reason,
      actionPriority: actionItem?.priority,
      isUpcoming,
    });

    if (activeTab === "actionRequired") {
      return actionRequiredItems.map((item) =>
        toListItem(
          item.client,
          item,
          normalizedUpcomingItems.some((upcomingItem) => upcomingItem.id === item.client.id),
        ),
      );
    }

    if (activeTab === "upcoming") {
      return normalizedUpcomingItems.map((item) =>
        toListItem(item, actionRequiredByClientId.get(item.id), true),
      );
    }

    const mergedItems = actionRequiredItems.map((item) =>
      toListItem(
        item.client,
        item,
        normalizedUpcomingItems.some((upcomingItem) => upcomingItem.id === item.client.id),
      ),
    );

    const mergedClientIds = new Set(mergedItems.map((item) => item.client.id));

    return [
      ...mergedItems,
      ...normalizedUpcomingItems.filter(
        (item) => !mergedClientIds.has(item.id),
      ).map((item) => toListItem(item, undefined, true)),
    ];
  }, [actionRequiredItems, upcomingItems, activeTab]);

  useEffect(() => {
    loadMoreTriggeredRef.current = false;
  }, [listItems.length, hasMore, isFetchingMore, activeTab]);

  useEffect(() => {
    if (!hasMore || !onLoadMore || isFetchingMore) {
      return;
    }

    const sentinel = sentinelRef.current;
    if (!sentinel) {
      return;
    }

    const scrollContainer = sentinel.closest('[data-component="recent-activities-panel-content"]');
    const root = scrollContainer instanceof HTMLElement ? scrollContainer : null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadMoreTriggeredRef.current) {
          return;
        }

        loadMoreTriggeredRef.current = true;
        onLoadMore();
      },
      {
        root,
        rootMargin: "200px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore, isFetchingMore]);

  return (
    <div
      className={cn(
        "bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden h-full",
        className,
      )}
    >
      <div className="border-v3-border">
        <div className="flex items-center justify-between p-6 pb-4">
        <h2 className="text-lg font-bold text-v3-dark">{title}</h2>
        </div>
        <div
          data-component="recent-activities-panel-tabs"
          className="flex min-h-[52px] items-center px-6 pb-3"
        >
          <div className="flex gap-1">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.value;

              return (
                <button
                  key={tab.value}
                  data-component="recent-activities-panel-tab-button"
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={cn(
                    "relative px-3 pb-2 text-[0.8rem] transition-colors",
                    isActive
                      ? "font-semibold text-primary"
                      : "text-v3-text-muted hover:text-v3-text"
                  )}
                >
                  {tab.label}
                  {isActive ? (
                    <span
                      data-component="recent-activities-panel-tab-indicator"
                      className="absolute bottom-0 left-0 h-0.5 w-full bg-primary"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          data-component="recent-activities-panel-content"
          className="p-6 pt-0 overflow-y-auto scrollbar-on-scroll h-full"
          data-scroll-active={isScrollActive ? "true" : "false"}
          onScroll={handleScroll}
        >
        {!isLoading && isError ? (
          <ErrorState onRetry={onRetry} />
        ) : !isLoading && (isEmpty || listItems.length === 0) ? (
          <FilterEmptyState activeTab={activeTab} />
        ) : (
          <>
            <AnimatedSlotList<RecentActivityListItem>
              items={listItems}
              isLoading={isLoading}
              loadingCount={activeTab === "all" ? 6 : 4}
              className="space-y-2"
              itemDataComponent="dashboard-split-list-item"
              getItemKey={(item) => item.key}
              onSlotClick={(item) => onSelect(item.client)}
              slotClassName={({ item, isLoading: loading }) =>
                cn(
                  "flex items-center gap-3 p-4 rounded-[18px] transition-all duration-200 bg-white border-2 border-transparent",
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
                          "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0",
                          iconBgClass,
                        )}
                      >
                        <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-24 bg-v3-dim-white" />
                          <Skeleton className="h-4 w-12 rounded-full bg-v3-dim-white" />
                        </div>
                        <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                      </div>
                      <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white shrink-0" />
                    </>
                  );
                }

                if (!item) {
                  return null;
                }

                if (item.actionReason) {
                  const colors = PRIORITY_COLORS[item.actionPriority ?? 3] || PRIORITY_COLORS[3];
                  const badgeVariant =
                    item.actionPriority === 1 ? "danger" : item.actionPriority === 2 ? "warning" : "primary";

                  return (
                    <>
                      <div
                        className={cn(
                          "w-11 h-11 rounded-[14px] flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md",
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
                            {item.actionReason}
                          </StatusPill>
                          {item.isUpcoming ? (
                            <StatusPill variant="primary" size="sm">
                              곧 시작
                            </StatusPill>
                          ) : null}
                        </div>
                        <p className="text-[0.7rem] text-v3-text-muted truncate">
                          {item.client.type || "일반"} · {item.client.primaryEmployee?.name || "-"}
                          {item.isUpcoming && item.client.startDate ? ` · ${getRelativeDate(item.client.startDate)}` : ""}
                        </p>
                      </div>
                    </>
                  );
                }

                return (
                  <>
                    <div
                      className={cn(
                        "w-11 h-11 rounded-[14px] flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md",
                        getAvatarGradient(item.client.name),
                      )}
                    >
                      {item.client.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                          {item.client.name}
                        </span>
                        <StatusPill variant="primary" size="sm">
                          곧 시작
                        </StatusPill>
                      </div>
                      <p className="text-[0.7rem] text-v3-text-muted truncate">
                        {item.client.type || "일반"} · {item.client.primaryEmployee?.name || "-"} ·{" "}
                        {item.client.startDate ? getRelativeDate(item.client.startDate) : "-"}
                      </p>
                    </div>
                  </>
                );
              }}
            />
          </>
        )}

        {hasMore && onLoadMore && !isFetchingMore ? (
          <div ref={sentinelRef} className="h-1" aria-hidden="true" />
        ) : null}

        {isFetchingMore ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-v3-primary" />
          </div>
        ) : null}

        {hasMore && !onLoadMore && (
          <Link
            href={viewAllHref}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[14px] border border-v3-border bg-v3-dim-white px-3 py-[11px] text-[0.75rem] font-bold text-v3-primary transition hover:-translate-y-0.5 hover:border-v3-primary/30 hover:bg-v3-primary-light"
          >
            {viewAllLabel} <span aria-hidden="true">→</span>
          </Link>
        )}
        </div>
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-white pointer-events-none z-20 rounded-b-[28px]" />
      </div>
    </div>
  );
}
