import "./redesign.css";

import type { ReactNode, RefObject } from "react";

import type { DashboardAnalytic, SectionRows } from "./mockup-data";
import { ListCard, ListRowsSkeleton, SectionedList } from "./primitives";
import { ListEmptyState, StatsBar } from "@/components/app/v3";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const DASHBOARD_SOURCE_COMPONENT = "DashboardRedesign";

/**
 * Canonical data-component base for the /dashboard route. DashboardRedesign is
 * rendered only by `app/(shell)/dashboard/page.tsx`, so the route base lives
 * here instead of being threaded through a prop.
 */
const DASHBOARD_BASE = "mobile_dashboard_page";
const DASHBOARD_ANALYTICS_BASE = `${DASHBOARD_BASE}_analytics-grid`;
const DASHBOARD_LIST_CARD_BASE = `${DASHBOARD_BASE}_content_list-card`;
const DASHBOARD_LIST_BODY_BASE = `${DASHBOARD_LIST_CARD_BASE}_body`;
const DASHBOARD_LIST_SKELETON_BASE = `${DASHBOARD_LIST_BODY_BASE}_loading-skeleton`;

export interface DashboardRedesignFilter {
  label: string;
  count: string;
  active?: boolean;
  skeleton?: boolean;
}

export interface DashboardRedesignProps {
  analytics: DashboardAnalytic[];
  sections: SectionRows[];
  filters: DashboardRedesignFilter[];
  activeFilter?: string;
  onFilterChange?: (label: string) => void;
  analyticsLoading?: boolean;
  loading?: boolean;
  isError?: boolean;
  isAnalyticsError?: boolean;
  isRetrying?: boolean;
  isRetryingAnalytics?: boolean;
  onRetry?: () => void;
  onRetryAnalytics?: () => void;
  /** Forwarded to ListCard — undefined/true shows the default load-more button, false/null hides it. */
  loadMore?: boolean | null;
  /** Forwarded to ListCard — click handler for the default load-more button. */
  onLoadMore?: () => void;
  /** Rendered at the end of the list body after the rows (infinite-scroll sentinel). */
  loadMoreSentinel?: ReactNode;
  /** Forwarded to ListCard so the reveal hook can measure the scroll area. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export function DashboardRedesign({
  analytics,
  sections,
  filters,
  activeFilter,
  onFilterChange,
  analyticsLoading = false,
  loading = false,
  isError = false,
  isAnalyticsError = false,
  isRetrying = false,
  isRetryingAnalytics = false,
  onRetry,
  onRetryAnalytics,
  loadMore,
  onLoadMore,
  loadMoreSentinel,
  scrollRef,
}: DashboardRedesignProps) {
  const emptyMessage = activeFilter === "조치 필요"
    ? "조치가 필요한 고객이 없습니다."
    : activeFilter === "시작 예정"
      ? "서비스 시작 예정 고객이 없습니다."
      : activeFilter === "종료 예정"
        ? "서비스 종료 예정 고객이 없습니다."
        : "최근 현황이 없습니다.";
  return (
    <section
      data-component={DASHBOARD_BASE}
      data-slot="dashboard-page"
      data-source-component={DASHBOARD_SOURCE_COMPONENT}
      className="flex h-full min-h-0 flex-col"
    >
      {isAnalyticsError ? (
        <div className="stats-grid" data-component={DASHBOARD_ANALYTICS_BASE} data-slot="stats-grid">
          <Alert
            data-component={`${DASHBOARD_ANALYTICS_BASE}_error`}
            variant="destructive" className="col-span-full"
            contentClassName="flex flex-col items-start gap-2"
          >
            <p>요약 정보를 불러오지 못했습니다.</p>
            <Button
              data-component={`${DASHBOARD_ANALYTICS_BASE}_error_retry`}
              variant="outline" size="sm" type="button"
              disabled={isRetryingAnalytics} onClick={onRetryAnalytics}
            >
              {isRetryingAnalytics ? "다시 시도 중…" : "다시 시도"}
            </Button>
          </Alert>
        </div>
      ) : <StatsBar
        data-component={DASHBOARD_ANALYTICS_BASE}
        items={analytics}
        isLoading={analyticsLoading}
        variant="compact"
      />}

      <div
        className="shell-content"
        data-component={`${DASHBOARD_BASE}_content`}
        data-slot="dashboard-content"
      >
        <ListCard
          data-component={DASHBOARD_LIST_CARD_BASE}
          title="최근 현황"
          count=""
          filters={isError ? filters.map((filter) => ({ ...filter, count: "—" })) : filters}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
          scrollRef={scrollRef}
          loadMore={isError || loading ? false : loadMore}
          onLoadMore={onLoadMore}
        >
          {isError ? (
            <Alert data-component={`${DASHBOARD_LIST_BODY_BASE}_error`} variant="destructive" contentClassName="flex flex-col items-start gap-2">
              <p>최근 현황을 불러오지 못했습니다.</p>
              <Button
                data-component={`${DASHBOARD_LIST_BODY_BASE}_error_retry`}
                variant="outline" size="sm" type="button"
                disabled={isRetrying} onClick={onRetry}
              >
                {isRetrying ? "다시 시도 중…" : "다시 시도"}
              </Button>
            </Alert>
          ) : loading ? (
            <ListRowsSkeleton
              data-component={DASHBOARD_LIST_SKELETON_BASE}
              rowCount={4}
            />
          ) : sections.every((section) => section.rows.length === 0) ? (
            <ListEmptyState name={`${DASHBOARD_LIST_BODY_BASE}_empty`} message={emptyMessage} />
          ) : (
            <>
              <SectionedList
                data-component={DASHBOARD_LIST_BODY_BASE}
                sections={sections}
                hideSectionHeader={() => true}
              />
              {loadMoreSentinel}
            </>
          )}
        </ListCard>
      </div>
    </section>
  );
}
