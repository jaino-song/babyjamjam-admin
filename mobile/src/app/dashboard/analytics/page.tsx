import "@/components/app/mobile-redesign/redesign.css";

export default function DashboardAnalyticsPage() {
  return (
    <section className="shell-content flex flex-col" data-component="dashboard-analytics-page">
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            통계 보고서
            <span className="list-count">이번 달</span>
          </span>
        </div>
        <div className="stats-grid" style={{ padding: "8px" }}>
          {[
            ["42", "전체 고객"],
            ["8", "진행중"],
            ["3", "시작 예정"],
            ["2", "처리 필요"],
          ].map(([value, label]) => (
            <div className="mini-stat" data-component="dashboard-analytics-stat" key={label}>
              <div>
                <div className="mini-stat-num">{value}</div>
                <div className="mini-stat-label">{label}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="action-feedback" role="status">
          상세 차트는 다음 iteration에서 연결됩니다.
        </div>
      </div>
    </section>
  );
}
