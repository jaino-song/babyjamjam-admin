"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleAlert, FileCheck2, FileText, MessageCircle, SquarePen } from "lucide-react";

import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useEformsignDocumentsByType } from "@/hooks/useEformsignDocuments";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import { EformsignDocument } from "@/lib/eformsign/types";
import {
  getStatusCategory,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";
import { Badge, ListCard } from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

type ContractCategory = "in-progress" | "drafting" | "completed" | "rejected";
type FilterKey = "전체" | "대기" | "검토 필요" | "완료" | "기간 만료";
type DetailTabId = "basic" | "signers" | "alimtalk";

const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];
const CONTRACT_ROUTE_BODY_CLASS = "mobile-contracts-route";
const FILTER_LABELS: FilterKey[] = ["전체", "대기", "검토 필요", "완료", "기간 만료"];

function customerName(doc: EformsignDocument): string {
  const recipients = doc.current_status?.step_recipients;
  if (recipients && recipients.length > 0 && recipients[0]?.name) return recipients[0].name;
  if (doc.last_editor?.name) return doc.last_editor.name;
  if (doc.creator?.name) return doc.creator.name;
  return "고객 미지정";
}

function categorize(doc: EformsignDocument): ContractCategory {
  const cat = getStatusCategory(doc.current_status?.status_type);
  if (cat === "completed" || cat === "rejected") return cat;
  const normalized = normalizeStatusCode(doc.current_status?.status_type);
  if (normalized === "001") return "drafting";
  return "in-progress";
}

function categoryTones(category: ContractCategory): {
  badge: string;
  badgeTone: "primary" | "green" | "muted" | "orange";
  iconBg: string;
  iconColor: string;
  badgeMini: string;
  infoTone: "primary" | "green" | "muted" | "orange";
} {
  switch (category) {
    case "completed":
      return {
        badge: "완료",
        badgeTone: "green",
        iconBg: "bg-v3-green-light",
        iconColor: "text-v3-green",
        badgeMini: "green",
        infoTone: "green",
      };
    case "rejected":
      return {
        badge: "만료",
        badgeTone: "muted",
        iconBg: "bg-v3-dim-white",
        iconColor: "text-v3-text-muted",
        badgeMini: "muted",
        infoTone: "muted",
      };
    case "drafting":
      return {
        badge: "대기",
        badgeTone: "muted",
        iconBg: "bg-v3-dim-white",
        iconColor: "text-v3-text-muted",
        badgeMini: "muted",
        infoTone: "muted",
      };
    default:
      return {
        badge: "검토 필요",
        badgeTone: "primary",
        iconBg: "bg-v3-primary-light",
        iconColor: "text-v3-primary",
        badgeMini: "primary",
        infoTone: "primary",
      };
  }
}

function contractNumber(doc: EformsignDocument): string {
  return doc.document_number || doc.id?.slice(0, 16) || "-";
}

function templateName(doc: EformsignDocument): string {
  return doc.template?.name?.replace(/\s*계약서$/, "") || "";
}

function contractDisplayName(doc: EformsignDocument, includeSuffix = false): string {
  const customer = customerName(doc);
  const template = templateName(doc);
  const fallback = doc.document_name || customer;
  const base = customer !== "고객 미지정" && template ? `${customer} · ${template}` : fallback;
  if (!includeSuffix || base.endsWith("계약서")) return base;
  return `${base} 계약서`;
}

function formatDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "-";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatCompactDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "-";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function formatDeadline(value: string | number | undefined | null): string {
  const formatted = formatDate(value);
  if (formatted === "-") return formatted;
  const d = typeof value === "number" ? new Date(value) : new Date(value ?? "");
  if (Number.isNaN(d.getTime())) return formatted;

  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diff = Math.ceil((target.getTime() - today.getTime()) / dayMs);

  if (diff < 0) return `${formatted} (만료)`;
  if (diff === 0) return `${formatted} (D-Day)`;
  return `${formatted} (D-${diff})`;
}

function recipientTotal(doc: EformsignDocument): number {
  const recipientCount = doc.current_status?.step_recipients?.length ?? 0;
  const stepGroup = Number(doc.current_status?.step_group ?? 0);
  return Math.max(recipientCount, stepGroup, 1);
}

function completedStepCount(doc: EformsignDocument, category: ContractCategory): number {
  const total = recipientTotal(doc);
  if (category === "completed") return total;
  if (category === "drafting") return 1;

  const stepIndex = Number(doc.current_status?.step_index ?? 0);
  if (!Number.isFinite(stepIndex) || stepIndex <= 0) return 0;
  return Math.min(Math.max(stepIndex - 1, 0), total);
}

function progressLabel(doc: EformsignDocument): string {
  const category = categorize(doc);
  const total = recipientTotal(doc);
  const done = completedStepCount(doc, category);

  if (category === "completed") return `완료 · ${total}/${total}`;
  if (category === "drafting") {
    const stepIndex = Number(doc.current_status?.step_index ?? 1);
    const draftingStep = Number.isFinite(stepIndex) ? Math.min(Math.max(stepIndex, 1), total) : 1;
    return `작성 진행 · ${draftingStep}/${total}`;
  }
  if (category === "rejected") return "기간 만료";
  return `서명 진행 · ${done}/${total}`;
}

function providerName(doc: EformsignDocument): string {
  const recipients = doc.current_status?.step_recipients ?? [];
  return recipients[1]?.name || recipients[0]?.name || "-";
}

function roleLabel(index: number): string {
  if (index === 0) return "고객";
  if (index === 1) return "관리사";
  return "지점장";
}

function ContractDocRow({
  icon,
  title,
  meta,
  badge,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  badge: string;
  tone: "primary" | "green" | "orange" | "muted";
}) {
  return (
    <div className="doc-row">
      <div className={`doc-icon contract-doc-icon-${tone}`}>{icon}</div>
      <div className="doc-info">
        <div className="doc-title">{title}</div>
        <div className="doc-meta">{meta}</div>
      </div>
      <span className={`badge-mini ${tone}`}>{badge}</span>
    </div>
  );
}

function ContractDetailContent({
  doc,
  activeTab,
  onTabChange,
}: {
  doc: EformsignDocument;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
}) {
  const [actionStatus, setActionStatus] = useState("");
  const category = categorize(doc);
  const tones = categoryTones(category);
  const contractNum = contractNumber(doc);
  const name = contractDisplayName(doc, true);
  const statusLabel = tones.badge;
  const recipients = doc.current_status?.step_recipients ?? [];
  const doneCount = completedStepCount(doc, category);
  const totalCount = recipientTotal(doc);

  return (
    <div className="detail-body detail-column" data-component="mobile-contracts-detail">
      <div className="client-detail-header pop-up">
        <div className={`client-detail-avatar-lg av-primary`}>
          <FileCheck2 size={24} strokeWidth={2.5} />
        </div>
        <div className="client-detail-title">
          <div className="client-detail-name" style={{ fontSize: "1rem" }}>
            {name}
          </div>
          <div className="client-detail-badges">
            <span className={`badge-mini ${tones.badgeMini}`}>{tones.badge}</span>
            <span
              className="badge-mini muted"
              style={{ fontFamily: "'SF Mono', monospace", fontSize: "0.6rem" }}
            >
              {contractNum}
            </span>
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => setActionStatus(`${name} 계약서 미리보기를 준비했습니다.`)}
          data-component="mobile-contracts-preview"
        >
          미리보기
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setActionStatus(`${name} 서명 화면을 엽니다.`)}
          data-component="mobile-contracts-sign"
        >
          지금 서명
        </button>
      </div>
      {actionStatus && (
        <div className="action-feedback" role="status">
          {actionStatus}
        </div>
      )}

      <DetailTabPills
        tabs={[
          { id: "basic", label: "기본 정보" },
          { id: "signers", label: "서명 진행" },
          { id: "alimtalk", label: "알림톡 발송 현황" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <div className={`tab-content ${activeTab === "basic" ? "active" : ""}`} data-tab-content="basic">
        <InfoCard title="계약 정보">
          <InfoRow
            label="계약 번호"
            value={<span style={{ fontFamily: "'SF Mono', monospace" }}>{contractNum}</span>}
          />
          <InfoRow label="계약서 유형" value={templateName(doc) || "-"} />
          <InfoRow label="현재 단계" value={statusLabel} tone={tones.infoTone} />
          <InfoRow label="작성일" value={formatDate(doc.created_date)} />
          <InfoRow label="마감일" value={formatDeadline(doc.current_status?.expired_date)} tone="orange" />
        </InfoCard>
        <InfoCard title="관련 정보" delay={60}>
          <InfoRow label="고객" value={customerName(doc)} />
          <InfoRow label="제공인력" value={providerName(doc)} />
          <InfoRow label="작성자" value={doc.creator?.name ?? "-"} />
          <InfoRow
            label="eformsign 코드"
            value={<span style={{ fontFamily: "'SF Mono', monospace" }}>{normalizeStatusCode(doc.current_status?.status_type)}</span>}
          />
        </InfoCard>
      </div>

      <div className={`tab-content ${activeTab === "signers" ? "active" : ""}`} data-tab-content="signers">
        <InfoCard title={`서명자 · ${totalCount}명`}>
          {recipients.length > 0 ? (
            recipients.map((recipient, idx) => {
              const isDone = category === "completed" || idx < doneCount;
              const isPending = !isDone && idx === doneCount;
              return (
                <ContractDocRow
                  key={`${recipient.name}-${idx}`}
                  icon={
                    isDone ? (
                      <FileCheck2 size={16} strokeWidth={2.5} />
                    ) : (
                      <CircleAlert size={16} strokeWidth={2.5} />
                    )
                  }
                  title={`${roleLabel(idx)} (${recipient.name || `서명자 ${idx + 1}`})`}
                  meta={
                    isDone
                      ? `${formatDate(doc.updated_date || doc.created_date)} 서명 완료`
                      : `${isPending ? "서명 대기 중" : "서명 예정"} · ${formatDeadline(doc.current_status?.expired_date)}`
                  }
                  badge={isDone ? "완료" : "대기"}
                  tone={isDone ? "green" : "orange"}
                />
              );
            })
          ) : (
            <div
              style={{
                fontSize: "0.82rem",
                color: "hsl(var(--v3-text-muted))",
                padding: "12px 0",
                textAlign: "center",
              }}
            >
              서명 정보가 없습니다.
            </div>
          )}
        </InfoCard>
        <InfoCard title="서명 진행률" delay={60}>
          <InfoRow
            label="완료"
            value={`${doneCount}명 / ${totalCount}명 (${Math.round((doneCount / totalCount) * 100)}%)`}
            tone="green"
          />
          <InfoRow
            label="잔여 서명자"
            value={recipients[doneCount]?.name || (doneCount < totalCount ? "확인 필요" : "-")}
          />
        </InfoCard>
      </div>

      <div className={`tab-content ${activeTab === "alimtalk" ? "active" : ""}`} data-tab-content="alimtalk">
        <InfoCard title="알림톡 · 3건">
          <ContractDocRow
            icon={<MessageCircle size={16} strokeWidth={2.5} />}
            title={`계약서 발송 안내 (${customerName(doc)})`}
            meta={`${formatCompactDate(doc.created_date)} 오전 9:32`}
            badge="완료"
            tone="green"
          />
          <ContractDocRow
            icon={<MessageCircle size={16} strokeWidth={2.5} />}
            title={`서명 요청 안내 (${providerName(doc)})`}
            meta={`${formatCompactDate(doc.updated_date || doc.created_date)} 오전 10:00`}
            badge={category === "drafting" ? "대기" : "완료"}
            tone={category === "drafting" ? "orange" : "green"}
          />
          <ContractDocRow
            icon={<CircleAlert size={16} strokeWidth={2.5} />}
            title={`마감 임박 알림 (${doc.creator?.name ?? "지점장"})`}
            meta={`${formatCompactDate(doc.current_status?.expired_date)} 오후 6:00 · 자동 발송`}
            badge="대기"
            tone="orange"
          />
        </InfoCard>
      </div>
    </div>
  );
}

export default function ContractsPage() {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("전체");
  const [selectedDoc, setSelectedDoc] = useState<EformsignDocument | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("basic");

  useEffect(() => {
    document.body.classList.add(CONTRACT_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(CONTRACT_ROUTE_BODY_CLASS);
    };
  }, []);

  const { isAuthenticated } = useEformsignAuth();
  const { data: allData } = useEformsignDocumentsByType(isAuthenticated, null);
  const { documents: infiniteDocuments } = useInfiniteContracts({
    enabled: isAuthenticated,
    filterType: null,
    excludedNames: EXCLUDED_CUSTOMER_NAMES,
  });

  const documents = infiniteDocuments;

  const grouped = useMemo(() => {
    const groups: Record<ContractCategory, EformsignDocument[]> = {
      "in-progress": [],
      drafting: [],
      completed: [],
      rejected: [],
    };
    for (const doc of documents) {
      groups[categorize(doc)].push(doc);
    }
    return groups;
  }, [documents]);

  const allDocuments = useMemo(
    () => (allData?.documents ?? []).filter((doc) => !EXCLUDED_CUSTOMER_NAMES.includes(customerName(doc))),
    [allData?.documents],
  );

  const allGrouped = useMemo(() => {
    const groups: Record<ContractCategory, EformsignDocument[]> = {
      "in-progress": [],
      drafting: [],
      completed: [],
      rejected: [],
    };
    for (const doc of allDocuments.length > 0 ? allDocuments : documents) {
      groups[categorize(doc)].push(doc);
    }
    return groups;
  }, [allDocuments, documents]);

  const filterItems = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      전체: allDocuments.length || documents.length,
      대기: allGrouped.drafting.length,
      "검토 필요": allGrouped["in-progress"].length,
      완료: allGrouped.completed.length,
      "기간 만료": allGrouped.rejected.length,
    };
    return FILTER_LABELS.map((label) => ({ label, count: String(counts[label]) }));
  }, [allDocuments.length, allGrouped, documents.length]);

  const visibleSections = useMemo(() => {
    const sections: Array<{
      key: string;
      title: string;
      docs: EformsignDocument[];
      category: ContractCategory;
    }> = [];

    const includeAll = activeFilter === "전체";
    const actionNeededTotal = allGrouped["in-progress"].length + allGrouped.drafting.length;
    const inProgressDocs = grouped["in-progress"];
    const primaryReviewDocs = includeAll ? inProgressDocs.slice(0, 1) : inProgressDocs;
    const progressDocs = includeAll ? inProgressDocs.slice(primaryReviewDocs.length) : [];
    const actionNeeded = [...primaryReviewDocs, ...grouped.drafting];

    if ((includeAll || activeFilter === "검토 필요" || activeFilter === "대기") && actionNeeded.length > 0) {
      sections.push({
        key: "action-needed",
        title: `조치 필요 · ${includeAll ? actionNeededTotal : actionNeeded.length}건`,
        docs: actionNeeded.filter((doc) => {
          if (activeFilter === "검토 필요") return categorize(doc) === "in-progress";
          if (activeFilter === "대기") return categorize(doc) === "drafting";
          return true;
        }),
        category: "in-progress",
      });
    }

    if (includeAll && progressDocs.length > 0) {
      sections.push({
        key: "in-progress",
        title: "진행 중",
        docs: progressDocs,
        category: "in-progress",
      });
    }

    if ((includeAll || activeFilter === "완료") && grouped.completed.length > 0) {
      sections.push({
        key: "completed",
        title: "완료 · 최근",
        docs: grouped.completed,
        category: "completed",
      });
    }

    if ((includeAll || activeFilter === "기간 만료") && grouped.rejected.length > 0) {
      sections.push({
        key: "rejected",
        title: `기간 만료/반려 · ${grouped.rejected.length}건`,
        docs: grouped.rejected,
        category: "rejected",
      });
    }

    return sections.filter((s) => s.docs.length > 0);
  }, [allGrouped, grouped, activeFilter]);

  const totalDocs = useMemo(
    () => allDocuments.length || documents.length,
    [allDocuments.length, documents.length],
  );

  return (
    <MobileDetailSheet
      name="contracts"
      isOpen={Boolean(selectedDoc)}
      onClose={() => setSelectedDoc(null)}
      list={
        <div className="shell-content" data-component="mobile-contracts-content">
          <ListCard
            title="계약서"
            count={`${totalDocs}건`}
            actionLabel="계약 작성"
            actionHref="/contracts/creation"
            filters={filterItems}
            activeFilter={activeFilter}
            onFilterChange={(label) => setActiveFilter(label as FilterKey)}
          >
            {visibleSections.length === 0 ? (
              <div
                style={{
                  padding: "32px 16px",
                  textAlign: "center",
                  fontSize: "0.82rem",
                  color: "hsl(var(--v3-text-muted))",
                }}
                data-component="mobile-contracts-empty"
              >
                {activeFilter !== "전체"
                  ? "조건에 맞는 계약서가 없습니다."
                  : "등록된 계약서가 없습니다."}
              </div>
            ) : (
              visibleSections.map((section) => (
                <div className="section-block" key={section.key}>
                  <div className="section-header">{section.title}</div>
                  {section.docs.map((doc) => {
                    const cat = categorize(doc);
                    const tones = categoryTones(cat);
                    const meta = progressLabel(doc);
                    const name = contractDisplayName(doc);

                    return (
                      <button
                        key={doc.id}
                        type="button"
                        className="contract-item"
                        data-component="mobile-contracts-row"
                        data-progress={tones.badge}
                        onClick={() => {
                          setSelectedDoc(doc);
                          setActiveTab("basic");
                        }}
                      >
                        <div
                          className={`contract-icon ${tones.iconBg} ${tones.iconColor}`}
                        >
                          {cat === "completed" ? (
                            <FileCheck2 size={18} strokeWidth={2.5} />
                          ) : cat === "drafting" ? (
                            <SquarePen size={18} strokeWidth={2.5} />
                          ) : (
                            <FileText size={18} strokeWidth={2.5} />
                          )}
                        </div>
                        <div className="contract-info">
                          <div className="contract-title">{name}</div>
                          <div className="contract-meta">
                            <span
                              className={
                                tones.badgeMini === "muted" || cat === "completed"
                                  ? "step-label muted"
                                  : "step-label"
                              }
                            >
                              {meta}
                            </span>
                          </div>
                        </div>
                        <div className="list-right">
                          <Badge label={tones.badge} tone={tones.badgeTone} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </ListCard>
        </div>
      }
      detail={
        selectedDoc ? (
          <ContractDetailContent
            doc={selectedDoc}
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
