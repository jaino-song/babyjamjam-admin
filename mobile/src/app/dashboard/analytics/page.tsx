"use client";

import { useClients } from "@/hooks/useClients";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import "@/components/app/mobile-redesign/redesign.css";

export default function DashboardAnalyticsPage() {
  const { data: stats, isLoading: statsLoading, isError: statsError } = useDashboardStats();
  const { data: clientsPage, isLoading: clientsLoading } = useClients(1, 1);

  const isLoading = statsLoading || clientsLoading;
  const hasData = !isLoading && stats && clientsPage;

  const totalClients = clientsPage?.total ?? 0;
  const activeClients = stats?.activeClients ?? 0;
  const upcomingThisMonth = stats?.upcomingThisMonth ?? 0;
  const pendingActions =
    (stats?.contractsPendingSignature ?? 0) + (stats?.contractsNotSent ?? 0);

  const cards: Array<[string, string]> = [
    [String(totalClients), "전체 고객"],
    [String(activeClients), "진행중"],
    [String(upcomingThisMonth), "이번 달 시작"],
    [String(pendingActions), "처리 필요"],
  ];

  return (
    <section className="shell-content flex flex-col" data-component="dashboard-analytics-page">
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            통계 보고서
            <span className="list-count">이번 달</span>
          </span>
        </div>
        {statsError ? (
          <div
            className="action-feedback"
            role="alert"
            data-component="dashboard-analytics-error"
          >
            통계를 불러오지 못했습니다.
          </div>
        ) : (
          <div className="stats-grid" style={{ padding: "8px" }}>
            {cards.map(([value, label]) => (
              <div className="mini-stat" data-component="dashboard-analytics-stat" key={label}>
                <div>
                  <div className="mini-stat-num">{isLoading ? "—" : value}</div>
                  <div className="mini-stat-label">{label}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {hasData && (
          <div className="action-feedback" role="status">
            상세 차트는 다음 iteration에서 연결됩니다.
          </div>
        )}
      </div>
    </section>
  );
}
