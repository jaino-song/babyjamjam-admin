"use client";

import { useClients } from "@/hooks/useClients";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { formatAnalyticsCount } from "@/lib/dashboard/analytics";
import "@/components/app/mobile-redesign/redesign.css";

export default function DashboardAnalyticsPage() {
  const {
    data: analytics,
    isLoading: analyticsLoading,
    isError: analyticsError,
  } = useDashboardAnalytics();
  const { data: clientsPage, isLoading: clientsLoading } = useClients(1, 1);

  const isLoading = analyticsLoading || clientsLoading;
  const hasData = !isLoading && analytics && clientsPage;

  const totalClients = clientsPage?.total ?? 0;
  // Unknown counts (server stats unavailable) show "-", never 0.
  const pendingReview = analytics?.contractsPendingSignature;
  const pendingSend = analytics?.contractsNotSent;
  const pendingActions =
    typeof pendingReview === "number" && typeof pendingSend === "number"
      ? pendingReview + pendingSend
      : null;

  const cards: Array<[string, string]> = [
    [String(totalClients), "전체 고객"],
    [formatAnalyticsCount(analytics?.activeClients), "진행중"],
    [formatAnalyticsCount(analytics?.upcomingWithinWeek), "7일 내 시작"],
    [formatAnalyticsCount(pendingActions), "처리 필요"],
  ];

  return (
    <section className="shell-content flex flex-col" data-component="mobile_dashboard_analytics-page">
      <div className="list-card" data-component="mobile_dashboard_analytics-page_card">
        <div className="list-title" data-component="mobile_dashboard_analytics-page_card_title">
          <span className="list-title-text">
            통계 보고서
            <span className="list-count">이번 달</span>
          </span>
        </div>
        {analyticsError ? (
          <div
            className="action-feedback"
            role="alert"
            data-component="mobile_dashboard_analytics-page_card_error"
          >
            통계를 불러오지 못했습니다.
          </div>
        ) : (
          <div
            className="stats-grid"
            style={{ padding: "8px" }}
            data-component="mobile_dashboard_analytics-page_card_grid"
          >
            {cards.map(([value, label]) => (
              <div
                className="mini-stat"
                data-component="mobile_dashboard_analytics-page_card_grid_stat"
                key={label}
              >
                <div data-component="mobile_dashboard_analytics-page_card_grid_stat_content">
                  <div
                    className="mini-stat-num"
                    data-component="mobile_dashboard_analytics-page_card_grid_stat_content_value"
                  >
                    {isLoading ? "—" : value}
                  </div>
                  <div
                    className="mini-stat-label"
                    data-component="mobile_dashboard_analytics-page_card_grid_stat_content_label"
                  >
                    {label}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {hasData && (
          <div
            className="action-feedback"
            role="status"
            data-component="mobile_dashboard_analytics-page_card_feedback"
          >
            상세 차트는 준비 중입니다.
          </div>
        )}
      </div>
    </section>
  );
}
