import "./redesign.css";

import type { ReactNode, RefObject } from "react";

import type { DashboardAnalytic, SectionRows } from "./mockup-data";
import { ListCard, ListRowsSkeleton, SectionedList } from "./primitives";
import { StatsBar } from "@/components/app/v3";

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
  loadMore,
  onLoadMore,
  loadMoreSentinel,
  scrollRef,
}: DashboardRedesignProps) {
  return (
    <section
      data-component={DASHBOARD_BASE}
      data-slot="dashboard-page"
      data-source-component={DASHBOARD_SOURCE_COMPONENT}
      className="flex h-full min-h-0 flex-col"
    >
      <StatsBar
        data-component={DASHBOARD_ANALYTICS_BASE}
        items={analytics}
        isLoading={analyticsLoading}
        variant="compact"
      />

      <div
        className="shell-content"
        data-component={`${DASHBOARD_BASE}_content`}
        data-slot="dashboard-content"
      >
        <ListCard
          data-component={DASHBOARD_LIST_CARD_BASE}
          title="최근 현황"
          count=""
          filters={filters}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
          scrollRef={scrollRef}
          loadMore={loadMore}
          onLoadMore={onLoadMore}
        >
          {loading ? (
            <ListRowsSkeleton
              data-component={DASHBOARD_LIST_SKELETON_BASE}
              rowCount={4}
            />
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
