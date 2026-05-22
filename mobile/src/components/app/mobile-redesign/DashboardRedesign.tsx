import "./redesign.css";

import type { DashboardStat, SectionRows } from "./mockup-data";
import { ListCard, SectionedList } from "./primitives";

const toneClass: Record<DashboardStat["tone"], string> = {
  primary: "bg-v3-primary-light text-v3-primary",
  orange: "bg-v3-orange-light text-v3-orange",
  green: "bg-v3-green-light text-v3-green",
  burgundy: "bg-v3-burgundy-light text-v3-burgundy",
};

export interface DashboardRedesignFilter {
  label: string;
  count: string;
  active?: boolean;
}

export interface DashboardRedesignProps {
  stats: DashboardStat[];
  sections: SectionRows[];
  filters: DashboardRedesignFilter[];
  activeFilter?: string;
  onFilterChange?: (label: string) => void;
}

export function DashboardRedesign({
  stats,
  sections,
  filters,
  activeFilter,
  onFilterChange,
}: DashboardRedesignProps) {
  return (
    <section data-component="dashboard" className="flex h-full min-h-0 flex-col">
      <div className="stats-grid" data-component="mobile-dashboard-stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div className="mini-stat" key={stat.label} data-component="mobile-dashboard-stat">
              <div className={`mini-stat-icon ${toneClass[stat.tone]}`}>
                <Icon size={18} strokeWidth={2.5} />
              </div>
              <div>
                <div className={`mini-stat-num ${stat.urgent ? "urgent" : ""}`}>{stat.value}</div>
                <div className="mini-stat-label">{stat.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shell-content" data-component="mobile-dashboard-content">
        <ListCard
          title="최근 현황"
          count=""
          filters={filters}
          activeFilter={activeFilter}
          onFilterChange={onFilterChange}
        >
          <SectionedList sections={sections} />
        </ListCard>
      </div>
    </section>
  );
}
