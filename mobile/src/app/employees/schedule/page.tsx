import "@/components/app/mobile-redesign/redesign.css";

export default function EmployeeSchedulePage() {
  return (
    <section className="shell-content flex flex-col" data-component="employee-schedule-page">
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            일정 캘린더
            <span className="list-count">데모 데이터</span>
          </span>
        </div>
        <div className="list-card-scroll">
          {[
            ["5/12 월", "김민지 · 박서연 방문", "09:00-18:00"],
            ["5/14 수", "윤지아 고객 서비스 시작", "배정 필요"],
            ["5/16 금", "정하늘 계약 상담", "14:00"],
          ].map(([date, title, meta]) => (
            <div className="list-item" data-component="employee-schedule-row" key={title}>
              <div className="list-avatar bg-v3-primary">{date.slice(2, 4)}</div>
              <div className="list-info">
                <div className="list-name">{title}</div>
                <div className="list-meta">{date}</div>
              </div>
              <div className="list-right">
                <span className="dday-sub">{meta}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="action-feedback" role="status">
          실제 일정 데이터 연동은 다음 iteration에서 진행됩니다.
        </div>
      </div>
    </section>
  );
}
