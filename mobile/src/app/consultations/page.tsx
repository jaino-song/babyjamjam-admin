import "@/components/app/mobile-redesign/redesign.css";

export default function ConsultationsPage() {
  const samples = [
    { initial: "[", name: "[더미] 정유진", meta: "정부지원 · D-3 출산", badge: "신규", tone: "burgundy" as const, avatar: "bg-v3-burgundy" },
    { initial: "박", name: "박서연", meta: "본인부담 · D-12 출산", badge: "연락 중", tone: "primary" as const, avatar: "bg-v3-green" },
    { initial: "이", name: "이수현", meta: "정부지원 · D+5 출산", badge: "완료", tone: "green" as const, avatar: "bg-v3-primary" },
  ];

  return (
    <section className="shell-content flex flex-col" data-component="consultations-page">
      <div className="list-card">
        <div className="list-title">
          <span className="list-title-text">
            상담 조회
            <span className="list-count">데모 데이터</span>
          </span>
        </div>

        <div className="list-card-scroll">
          {samples.map((row) => (
            <div className="list-item" data-component="consultation-row" key={row.name}>
              <div className={`list-avatar ${row.avatar}`}>{row.initial}</div>
              <div className="list-info">
                <div className="list-name">{row.name}</div>
                <div className="list-meta">{row.meta}</div>
              </div>
              <div className="list-right">
                <span className={`badge badge-${row.tone}`}>{row.badge}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="action-feedback" role="status">
          실제 상담 데이터(/consultation-inquiries)는 다음 iteration에서 연동합니다.
        </div>
      </div>
    </section>
  );
}
