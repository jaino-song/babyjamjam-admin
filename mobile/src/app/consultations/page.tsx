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
import {
  useConsultationInquiries,
  useMarkConsultationInquiryAsRead,
} from "@/hooks/use-consultation-inquiries";
import type { ConsultationInquiry } from "@/lib/consultation-inquiry/types";
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
  source: string;
  sourceShort: string;
  region: string;
  address: string;
  birthExperience: string;
  preferredCaregiverName: string | null;
  selectedPlan: string | null;
  selectedPlanPrice: string | null;
  selectedDurationDays: number | null;
  selectedAddons: Array<{ name: string; quantity: number; priceLabel: string }>;
  inquiryStatus: string;
  referralSource: string;
  dueDateLabel: string;
}

const ALL_FILTER = "전체";
const AVATAR_TONES: AvatarTone[] = ["primary", "green", "burgundy", "orange", "purple"];
const AVATAR_TONE_BY_INITIAL: Record<string, AvatarTone> = {
  홍: "burgundy",
  서: "primary",
  김: "green",
  이: "orange",
  한: "purple",
  박: "primary",
  윤: "burgundy",
  최: "green",
};

function pickAvatarTone(seed: string): AvatarTone {
  const mappedTone = AVATAR_TONE_BY_INITIAL[seed];
  if (mappedTone) return mappedTone;

  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

function classifyVoucher(voucherType: string | null): VoucherKind {
  if (!voucherType) return "self";
  if (voucherType === "일반") return "self";
  return /^[A-Za-z]/.test(voucherType) ? "govt" : "self";
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const now = Date.now();
  const diff = now - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < 5 * minute) return "방금";
  if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < 2 * day) return "어제";
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDueDate(iso: string): { short: string; long: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { short: "-", long: "-" };
  const short = `출산 예정 ${date.getMonth() + 1}/${date.getDate()}`;
  const long = `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
  return { short, long };
}

function humanizeSource(source: string): string {
  if (source === "website") return "웹사이트 문의 폼";
  if (source === "phone") return "전화 문의";
  return source || "-";
}

function shortSourceLabel(source: string): string {
  if (source === "website") return "웹";
  if (source === "phone") return "전화";
  return source || "-";
}

function extractRegion(address: string): string {
  const parts = address.trim().split(/\s+/);
  return parts.slice(0, 2).join(" ") || address || "-";
}

function inquiryStatusLabel(status: string): string {
  if (status === "new") return "신규";
  if (status === "contacted") return "연락 중";
  if (status === "closed") return "완료";
  return status;
}

function toRow(inquiry: ConsultationInquiry): ConsultationRow {
  const initial = inquiry.motherName.trim().charAt(0) || "?";
  const due = formatDueDate(inquiry.dueDate);
  const voucher = inquiry.voucherType?.trim() || "일반";
  return {
    id: inquiry.id,
    initial,
    avatarTone: pickAvatarTone(initial || inquiry.id),
    name: inquiry.motherName,
    voucher,
    voucherKind: classifyVoucher(inquiry.voucherType),
    due: due.short,
    right: formatRelativeTime(inquiry.createdAt),
    status: inquiry.readAt === null ? "unread" : "confirmed",
    contact: inquiry.phone,
    source: humanizeSource(inquiry.source),
    sourceShort: shortSourceLabel(inquiry.source),
    region: extractRegion(inquiry.address),
    address: inquiry.address,
    birthExperience: inquiry.birthExperience,
    preferredCaregiverName: inquiry.preferredCaregiverName,
    selectedPlan: inquiry.selectedServices?.plan?.name ?? null,
    selectedPlanPrice: inquiry.selectedServices?.plan?.priceLabel ?? null,
    selectedDurationDays: inquiry.selectedServices?.plan?.durationDays ?? null,
    selectedAddons:
      inquiry.selectedServices?.addons?.map((addon) => ({
        name: addon.name,
        quantity: addon.quantity,
        priceLabel: addon.priceLabel,
      })) ?? [],
    inquiryStatus: inquiry.status,
    referralSource: inquiry.referralSource,
    dueDateLabel: due.long,
  };
}

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
  const inquiryBody = [
    "안녕하세요, 산후도우미 서비스를 신청하고 싶어 문의드립니다.",
    `${row.voucher} 유형으로 알아보고 있습니다. 출산 예정일은 ${row.dueDateLabel}이고 ${row.region} 거주합니다.`,
    "가능한 매니저가 있으면 연락 부탁드려요.",
  ].join("\n\n");

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
            <span className="badge-mini muted">
              {row.sourceShort} · {row.right}
            </span>
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
          <div className="consultation-body-copy" data-component="mobile-consultations-inquiry-body">
            {inquiryBody}
          </div>
        </InfoCard>
        <InfoCard title="자동 추출 정보" delay={60}>
          <InfoRow label="희망 시작일" value="-" />
          <InfoRow
            label="희망 기간"
            value={row.selectedDurationDays ? `${row.selectedDurationDays}일` : "-"}
          />
          <InfoRow label="바우처 유형" value={row.voucher} />
          <InfoRow label="출산 예정일" value={row.dueDateLabel} />
          <InfoRow label="근무 지역" value={row.region} />
        </InfoCard>
        {(row.selectedPlan || row.selectedAddons.length > 0) && (
          <InfoCard title="선택한 서비스" delay={120}>
            {row.selectedPlan && (
              <InfoRow
                label={
                  row.selectedDurationDays
                    ? `${row.selectedPlan} · ${row.selectedDurationDays}일`
                    : row.selectedPlan
                }
                value={row.selectedPlanPrice || "-"}
              />
            )}
            {row.selectedAddons.map((addon) => (
              <InfoRow
                key={`${addon.name}-${addon.priceLabel}`}
                label={addon.quantity > 1 ? `${addon.name} × ${addon.quantity}` : addon.name}
                value={addon.priceLabel}
              />
            ))}
          </InfoCard>
        )}
      </div>

      <div
        className={`tab-content ${activeTab === "info" ? "active" : ""}`}
        data-tab-content="info"
      >
        <InfoCard title="기본 정보">
          <InfoRow label="이름" value={row.name} />
          <InfoRow label="연락처" value={row.contact} />
          <InfoRow label="주소" value={row.address || "-"} />
          <InfoRow label="출산 경험" value={row.birthExperience || "-"} />
          <InfoRow label="출처" value={row.source} />
          <InfoRow label="추천 경로" value={row.referralSource || "-"} />
          {row.preferredCaregiverName && (
            <InfoRow label="선호 매니저" value={row.preferredCaregiverName} />
          )}
        </InfoCard>
        <InfoCard title="문의 상태" delay={60}>
          <InfoRow
            label="확인 여부"
            value={row.status === "unread" ? "미확인" : "확인 완료"}
            tone={row.status === "unread" ? "burgundy" : "green"}
          />
          <InfoRow label="진행 상태" value={inquiryStatusLabel(row.inquiryStatus)} />
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("inquiry");

  const { data, isLoading, isError } = useConsultationInquiries({ limit: 100 });
  const markRead = useMarkConsultationInquiryAsRead();

  const rows = useMemo<ConsultationRow[]>(
    () => (data?.data ?? []).map(toRow),
    [data],
  );

  const unreadRows = useMemo(() => rows.filter((r) => r.status === "unread"), [rows]);
  const confirmedRows = useMemo(() => rows.filter((r) => r.status === "confirmed"), [rows]);

  const filterItems = [
    { label: ALL_FILTER, count: String(rows.length) },
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

  const selectedRow = useMemo(
    () => (selectedId ? rows.find((r) => r.id === selectedId) ?? null : null),
    [selectedId, rows],
  );

  const handleSelectRow = (row: ConsultationRow) => {
    setSelectedId(row.id);
    setActiveTab("inquiry");
    if (row.status === "unread") {
      markRead.mutate(row.id);
    }
  };

  return (
    <MobileDetailSheet
      name="consultations"
      isOpen={selectedRow !== null}
      onClose={() => setSelectedId(null)}
      list={
        <div className="shell-content" data-component="mobile-consultations-content">
          <ListCard
            title="상담 조회"
            count={`${rows.length}건`}
            filters={filterItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
          >
            {isLoading ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-consultations-loading"
              >
                불러오는 중...
              </div>
            ) : isError ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-burgundy))",
                }}
                data-component="mobile-consultations-error"
              >
                상담 문의를 불러오지 못했습니다.
              </div>
            ) : visibleSections.length === 0 ? (
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
                      onClick={() => handleSelectRow(row)}
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
        selectedRow ? (
          <ConsultationDetail
            row={selectedRow}
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
