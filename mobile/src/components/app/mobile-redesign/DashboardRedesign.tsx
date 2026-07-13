import "./redesign.css";

import type { DashboardAnalytic, SectionRows } from "./mockup-data";
import { ListCard, SectionedList } from "./primitives";
import { Skeleton } from "@/components/ui/skeleton";

const toneClass: Record<DashboardAnalytic["tone"], string> = {
  primary: "bg-v3-primary-light text-v3-primary",
  orange: "bg-v3-orange-light text-v3-orange",
  green: "bg-v3-green-light text-v3-green",
  burgundy: "bg-v3-burgundy-light text-v3-burgundy",
};

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
}

function DashboardAnalyticsSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`dashboard-analytic-skeleton-${index}`}
          className="mini-stat mini-stat-skeleton"
          data-component="mobile-dashboard-analytic-skeleton"
          aria-hidden="true"
        >
          <Skeleton className="mini-stat-icon bg-v3-dim-white" />
          <div className="mini-stat-skeleton-text">
            <Skeleton className="mini-stat-skeleton-num bg-v3-dim-white" />
            <Skeleton className="mini-stat-skeleton-label bg-v3-dim-white" />
          </div>
        </div>
      ))}
    </>
  );
}

function DashboardListSkeleton() {
  return (
    <div className="section-block" data-component="mobile-dashboard-loading-skeleton">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`dashboard-skeleton-${index}`}
          className="list-item"
          data-component="mobile-dashboard-row-skeleton"
          aria-hidden="true"
          style={{ animationDelay: `${index * 40}ms` }}
        >
          <Skeleton className="list-avatar rounded-full bg-v3-dim-white animate-pulse" />
          <div className="list-info flex flex-col" data-component="mobile-dashboard-row-skeleton-info">
            <Skeleton className="h-4 w-24 bg-v3-dim-white animate-pulse" />
            <Skeleton className="mt-1.5 h-3 w-32 bg-v3-dim-white animate-pulse" />
          </div>
          <div className="list-right" data-component="mobile-dashboard-row-skeleton-right">
            <Skeleton className="h-4 w-14 bg-v3-dim-white animate-pulse" />
            <Skeleton className="h-3 w-10 bg-v3-dim-white animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardRedesign({
  analytics,
  sections,
  filters,
  activeFilter,
  onFilterChange,
  analyticsLoading = false,
  loading = false,
}: DashboardRedesignProps) {
  return (
    <section data-component="dashboard" className="flex h-full min-h-0 flex-col">
      <div className="stats-grid" data-component="mobile-dashboard-analytics-grid">
        {analyticsLoading ? (
          <DashboardAnalyticsSkeleton />
        ) : (
          analytics.map((item) => {
            const Icon = item.icon;
            return (
              <div className="mini-stat" key={item.label} data-component="mobile-dashboard-analytic">
                <div className={`mini-stat-icon ${toneClass[item.tone]}`}>
                  <Icon size={18} strokeWidth={2.5} />
                </div>
                <div>
                  <div className={`mini-stat-num ${item.urgent ? "urgent" : ""}`}>{item.value}</div>
                  <div className="mini-stat-label">{item.label}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="shell-content" data-component="mobile-dashboard-content">
        <ListCard
          title="최근 현황"
          count=""
          filters={filters}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        >
          {loading ? (
            <DashboardListSkeleton />
          ) : (
            <SectionedList
              sections={sections}
              hideSectionHeader={() => true}
            />
          )}
        </ListCard>
      </div>
    </section>
  );
}
