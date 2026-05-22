"use client";

import { useMemo, useState } from "react";

import { ListCard } from "@/components/app/mobile-redesign/primitives";
import {
  Avatar,
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
  type AvatarTone,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

type ConsultationStatus = "unread" | "confirmed";
type VoucherKind = "govt" | "self";
type DetailTabId = "inquiry" | "info" | "thread";

interface ConsultationRow {
  id: string;
  initial: string;
  avatarTone: AvatarTone;
  name: string;
  voucher: string;
  voucherKind: VoucherKind;
  due: string;
  right: string;
  status: ConsultationStatus;
  contact: string;
  email: string;
  source: string;
  ip: string;
  inquiryBody: string;
  desiredStart: string;
  desiredDuration: string;
  region: string;
}

const ALL_FILTER = "전체";

const CONSULTATION_ROWS: ConsultationRow[] = [
  {
    id: "c-001",
    initial: "홍",
    avatarTone: "burgundy",
    name: "홍은지",
    voucher: "A라1형",
    voucherKind: "govt",
    due: "출산 예정 5/16",
    right: "10분 전",
    status: "unread",
    contact: "010-3456-7890",
    email: "eunji_h@example.com",
    source: "웹사이트 문의 폼",
    ip: "인천 부평구 (180.69.X.X)",
    inquiryBody:
      "안녕하세요, 5월 셋째주(5/19~5/31)에 산후도우미 서비스를 신청하고 싶어 문의드립니다.\n\nA라1형 바우처 가지고 있고 14일 기간으로 알아보고 있습니다. 출산 예정일은 5월 18일이고 인천 부평구 거주합니다.\n\n가능한 분 있으면 연락 부탁드려요.",
    desiredStart: "2025. 5. 19.",
    desiredDuration: "14일",
    region: "인천 부평구",
  },
  {
    id: "c-002",
    initial: "서",
    avatarTone: "primary",
    name: "서영민",
    voucher: "일반",
    voucherKind: "self",
    due: "출산 예정 7/8",
    right: "38분 전",
    status: "unread",
    contact: "010-1111-2222",
    email: "youngmin_s@example.com",
    source: "웹사이트 문의 폼",
    ip: "인천 남동구 (210.5.X.X)",
    inquiryBody: "본인부담으로 21일 서비스 받고 싶어요. 7월 초중순 시작 희망합니다.",
    desiredStart: "2025. 7. 5.",
    desiredDuration: "21일",
    region: "인천 남동구",
  },
  {
    id: "c-003",
    initial: "김",
    avatarTone: "green",
    name: "김다영",
    voucher: "일반",
    voucherKind: "self",
    due: "출산 예정 6/22",
    right: "2시간 전",
    status: "unread",
    contact: "010-2222-3333",
    email: "dayoung_k@example.com",
    source: "웹사이트 문의 폼",
    ip: "인천 미추홀구 (210.7.X.X)",
    inquiryBody: "본인부담 14일 정도 알아보고 있어요.",
    desiredStart: "2025. 6. 22.",
    desiredDuration: "14일",
    region: "인천 미추홀구",
  },
  {
    id: "c-004",
    initial: "이",
    avatarTone: "orange",
    name: "이지원",
    voucher: "D가2형",
    voucherKind: "govt",
    due: "출산 예정 5/30",
    right: "4시간 전",
    status: "unread",
    contact: "010-3333-4444",
    email: "jiwon_l@example.com",
    source: "웹사이트 문의 폼",
    ip: "인천 연수구 (210.9.X.X)",
    inquiryBody: "D가2형 바우처 있고 출산 후 곧바로 시작 가능한 분 찾고 있어요.",
    desiredStart: "2025. 5. 30.",
    desiredDuration: "21일",
    region: "인천 연수구",
  },
  {
    id: "c-005",
    initial: "한",
    avatarTone: "purple",
    name: "한지유",
    voucher: "일반",
    voucherKind: "self",
    due: "출산 예정 8/14",
    right: "5시간 전",
    status: "unread",
    contact: "010-4444-5555",
    email: "jiyu_h@example.com",
    source: "웹사이트 문의 폼",
    ip: "인천 부평구 (180.69.X.X)",
    inquiryBody: "8월 중순 출산 예정입니다. 본인부담으로 14일 알아보고 있어요.",
    desiredStart: "2025. 8. 14.",
    desiredDuration: "14일",
    region: "인천 부평구",
  },
  {
    id: "c-006",
    initial: "박",
    avatarTone: "primary",
    name: "박지영",
    voucher: "A통합1형",
    voucherKind: "govt",
    due: "출산 예정 5/24",
    right: "어제",
    status: "confirmed",
    contact: "010-5555-6666",
    email: "jiyoung_p@example.com",
    source: "웹사이트 문의 폼",
    ip: "인천 부평구 (180.69.X.X)",
    inquiryBody: "A통합1형 바우처 사용해서 18일 알아보고 있습니다.",
    desiredStart: "2025. 5. 24.",
    desiredDuration: "18일",
    region: "인천 부평구",
  },
  {
    id: "c-007",
    initial: "윤",
    avatarTone: "burgundy",
    name: "윤소희",
    voucher: "A라2형",
    voucherKind: "govt",
    due: "출산 예정 5/15",
    right: "5/8",
    status: "confirmed",
    contact: "010-6666-7777",
    email: "sohee_y@example.com",
    source: "전화 문의",
    ip: "-",
    inquiryBody: "A라2형 바우처 14일 신청합니다.",
    desiredStart: "2025. 5. 15.",
    desiredDuration: "14일",
    region: "인천 부평구",
  },
  {
    id: "c-008",
    initial: "최",
    avatarTone: "green",
    name: "최예린",
    voucher: "D가1형",
    voucherKind: "govt",
    due: "출산 예정 5/4",
    right: "4/28",
    status: "confirmed",
    contact: "010-7777-8888",
    email: "yelin_c@example.com",
    source: "웹사이트 문의 폼",
    ip: "인천 서구 (210.3.X.X)",
    inquiryBody: "D가1형 14일 알아봅니다.",
    desiredStart: "2025. 5. 4.",
    desiredDuration: "14일",
    region: "인천 서구",
  },
];

function ConsultationDetail({
  row,
  activeTab,
  onTabChange,
}: {
  row: ConsultationRow;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
}) {
  const [actionStatus, setActionStatus] = useState("");

  return (
    <div className="detail-body detail-column" data-component="mobile-consultations-detail">
      <div className="client-detail-header pop-up">
        <Avatar initial={row.initial} tone={row.avatarTone} large />
        <div className="client-detail-title">
          <div className="client-detail-name">{row.name}</div>
          <div className="client-detail-badges">
            <span className={`badge-mini ${row.status === "unread" ? "burgundy" : "green"}`}>
              {row.status === "unread" ? "미확인" : "확인 완료"}
            </span>
            <span className="badge-mini muted">웹 · {row.right}</span>
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => setActionStatus(`${row.name} 고객에게 답장 패널을 열었습니다.`)}
          data-component="mobile-consultations-reply"
        >
          답장
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setActionStatus(`${row.name} 고객을 등록 화면으로 이동합니다.`)}
          data-component="mobile-consultations-register"
        >
          고객 등록
        </button>
      </div>
      {actionStatus && (
        <div className="action-feedback" role="status">
          {actionStatus}
        </div>
      )}

      <DetailTabPills
        tabs={[
          { id: "inquiry", label: "문의 내용" },
          { id: "info", label: "고객 정보" },
          { id: "thread", label: "응답 이력" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <div
        className={`tab-content ${activeTab === "inquiry" ? "active" : ""}`}
        data-tab-content="inquiry"
      >
        <InfoCard title="문의 본문" padded>
          <div
            style={{
              fontSize: "0.84rem",
              lineHeight: 1.55,
              color: "hsl(var(--v3-dark))",
              whiteSpace: "pre-wrap",
            }}
          >
            {row.inquiryBody}
          </div>
        </InfoCard>
        <InfoCard title="자동 추출 정보" delay={60}>
          <InfoRow label="희망 시작일" value={row.desiredStart} />
          <InfoRow label="희망 기간" value={row.desiredDuration} />
          <InfoRow label="바우처 유형" value={row.voucher} />
          <InfoRow label="출산 예정일" value={row.due.replace("출산 예정 ", "")} />
          <InfoRow label="근무 지역" value={row.region} />
        </InfoCard>
      </div>

      <div
        className={`tab-content ${activeTab === "info" ? "active" : ""}`}
        data-tab-content="info"
      >
        <InfoCard title="기본 정보">
          <InfoRow label="이름" value={row.name} />
          <InfoRow label="연락처" value={row.contact} />
          <InfoRow label="이메일" value={row.email} />
          <InfoRow label="출처" value={row.source} />
          <InfoRow label="접속 IP" value={row.ip} />
        </InfoCard>
        <InfoCard title="신규 고객 여부" delay={60}>
          <InfoRow label="기존 고객 매칭" value="없음 (신규)" tone="muted" />
          <InfoRow label="유사 고객" value="없음" />
        </InfoCard>
      </div>

      <div
        className={`tab-content ${activeTab === "thread" ? "active" : ""}`}
        data-tab-content="thread"
      >
        <InfoCard title="응답 이력 · 0건">
          <div
            style={{
              textAlign: "center",
              padding: "24px 12px",
              color: "hsl(var(--v3-text-muted))",
              fontSize: "0.78rem",
              lineHeight: 1.5,
            }}
          >
            아직 응답하지 않았습니다.
            <br />
            위의 답장 또는 고객 등록 버튼으로 시작하세요.
          </div>
        </InfoCard>
      </div>
    </div>
  );
}

export default function ConsultationsPage() {
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [selected, setSelected] = useState<ConsultationRow | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("inquiry");

  const unreadRows = useMemo(
    () => CONSULTATION_ROWS.filter((r) => r.status === "unread"),
    [],
  );
  const confirmedRows = useMemo(
    () => CONSULTATION_ROWS.filter((r) => r.status === "confirmed"),
    [],
  );

  const filterItems = [
    { label: ALL_FILTER, count: String(CONSULTATION_ROWS.length) },
    { label: "미확인", count: String(unreadRows.length) },
    { label: "확인", count: String(confirmedRows.length) },
  ];

  const visibleSections = useMemo(() => {
    const sections: Array<{ title: string; rows: ConsultationRow[] }> = [];
    if (activeFilter === ALL_FILTER || activeFilter === "미확인") {
      if (unreadRows.length > 0) {
        sections.push({ title: `미확인 · ${unreadRows.length}건`, rows: unreadRows });
      }
    }
    if (activeFilter === ALL_FILTER || activeFilter === "확인") {
      if (confirmedRows.length > 0) {
        sections.push({ title: `확인 완료 · ${confirmedRows.length}건`, rows: confirmedRows });
      }
    }
    return sections;
  }, [activeFilter, unreadRows, confirmedRows]);

  return (
    <MobileDetailSheet
      name="consultations"
      isOpen={Boolean(selected)}
      onClose={() => setSelected(null)}
      list={
        <div className="shell-content" data-component="mobile-consultations-content">
          <ListCard
            title="상담 조회"
            count={`${CONSULTATION_ROWS.length}건`}
            filters={filterItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          >
            {visibleSections.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-consultations-empty"
              >
                상담 문의가 없습니다.
              </div>
            ) : (
              visibleSections.map((section) => (
                <div className="section-block" key={section.title}>
                  <div className="section-header">{section.title}</div>
                  {section.rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className={`list-item ${row.status === "unread" ? "unread-row" : ""}`}
                      data-component="mobile-consultations-row"
                      onClick={() => {
                        setSelected(row);
                        setActiveTab("inquiry");
                      }}
                    >
                      <div className={`list-avatar av-${row.avatarTone}`}>{row.initial}</div>
                      <div className="list-info">
                        <div className="list-name">{row.name}</div>
                        <div className="consult-snippet">
                          <span className={`voucher-tag ${row.voucherKind}`}>{row.voucher}</span>
                          <span className="snippet-sep">·</span>
                          {row.due}
                        </div>
                      </div>
                      <div className="list-right">
                        <span className="dday-sub">{row.right}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </ListCard>
        </div>
      }
      detail={
        selected ? (
          <ConsultationDetail
            row={selected}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        ) : (
          <div className="detail-body" />
        )
      }
    />
  );
}
