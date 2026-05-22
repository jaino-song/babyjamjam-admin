"use client";

import { useMemo, useState } from "react";
import { FileCheck2, FileText } from "lucide-react";

import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useEformsignDocumentsByType } from "@/hooks/useEformsignDocuments";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import { EformsignDocument } from "@/lib/eformsign/types";
import {
  getStatusCategory,
  mapStatusToLabel,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { Badge, ListCard } from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];

type ContractCategory = "in-progress" | "drafting" | "completed" | "rejected";
type FilterKey = "전체" | "대기" | "검토 필요" | "완료" | "기간 만료";
type DetailTabId = "basic" | "signers" | "alimtalk";

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
} {
  switch (category) {
    case "completed":
      return {
        badge: "완료",
        badgeTone: "green",
        iconBg: "bg-v3-green-light",
        iconColor: "text-v3-green",
        badgeMini: "green",
      };
    case "rejected":
      return {
        badge: "만료",
        badgeTone: "muted",
        iconBg: "bg-v3-dim-white",
        iconColor: "text-v3-text-muted",
        badgeMini: "muted",
      };
    case "drafting":
      return {
        badge: "대기",
        badgeTone: "muted",
        iconBg: "bg-v3-dim-white",
        iconColor: "text-v3-text-muted",
        badgeMini: "muted",
      };
    default:
      return {
        badge: "검토 필요",
        badgeTone: "primary",
        iconBg: "bg-v3-primary-light",
        iconColor: "text-v3-primary",
        badgeMini: "primary",
      };
  }
}

function formatDate(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "-";
  const d = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
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
  const contractNum = doc.id?.slice(0, 16) || "-";
  const name = doc.document_name || customerName(doc);
  const statusLabel = mapStatusToLabel(doc.current_status?.status_type) ?? tones.badge;

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
          <InfoRow label="현재 단계" value={statusLabel} tone={tones.badgeMini as never} />
          <InfoRow label="작성일" value={formatDate(doc.created_date)} />
          <InfoRow label="마감일" value={formatDate(doc.current_status?.expired_date)} />
        </InfoCard>
        <InfoCard title="관련 정보" delay={60}>
          <InfoRow label="고객" value={customerName(doc)} />
          <InfoRow label="작성자" value={doc.creator?.name ?? "-"} />
          <InfoRow label="최종 편집자" value={doc.last_editor?.name ?? "-"} />
        </InfoCard>
      </div>

      <div className={`tab-content ${activeTab === "signers" ? "active" : ""}`} data-tab-content="signers">
        <InfoCard title="서명자">
          {doc.current_status?.step_recipients && doc.current_status.step_recipients.length > 0 ? (
            <div>
              {doc.current_status.step_recipients.map((recipient, idx) => (
                <InfoRow
                  key={`${recipient.name}-${idx}`}
                  label={recipient.name || `서명자 ${idx + 1}`}
                  value={recipient.recipient_type || statusLabel}
                />
              ))}
            </div>
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
      </div>

      <div className={`tab-content ${activeTab === "alimtalk" ? "active" : ""}`} data-tab-content="alimtalk">
        <InfoCard title="알림톡 발송 이력">
          <div
            style={{
              fontSize: "0.82rem",
              color: "hsl(var(--v3-text-muted))",
              padding: "24px 12px",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            해당 계약의 알림톡 발송 이력은
            <br />
            메시지 화면에서 확인하실 수 있습니다.
          </div>
        </InfoCard>
      </div>
    </div>
  );
}

export default function ContractsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("전체");
  const [selectedDoc, setSelectedDoc] = useState<EformsignDocument | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>("basic");

  const { isAuthenticated } = useEformsignAuth();
  const { data: allData } = useEformsignDocumentsByType(isAuthenticated, null);
  const { documents: infiniteDocuments } = useInfiniteContracts({
    enabled: isAuthenticated,
    filterType: null,
    excludedNames: EXCLUDED_CUSTOMER_NAMES,
  });

  const documents = useMemo(() => {
    if (!searchQuery.trim()) return infiniteDocuments;
    return infiniteDocuments.filter((doc) => {
      const name = customerName(doc);
      const q = searchQuery.trim();
      if (matchesKoreanSearch(name, q)) return true;
      if (doc.document_name?.toLowerCase().includes(q.toLowerCase())) return true;
      return false;
    });
  }, [infiniteDocuments, searchQuery]);

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

  const filterItems = useMemo(() => {
    const items: Array<{ label: string; count: string }> = [
      { label: "전체", count: String(documents.length) },
    ];
    if (grouped.drafting.length > 0) items.push({ label: "대기", count: String(grouped.drafting.length) });
    if (grouped["in-progress"].length > 0)
      items.push({ label: "검토 필요", count: String(grouped["in-progress"].length) });
    if (grouped.completed.length > 0)
      items.push({ label: "완료", count: String(grouped.completed.length) });
    if (grouped.rejected.length > 0)
      items.push({ label: "기간 만료", count: String(grouped.rejected.length) });
    return items;
  }, [documents.length, grouped]);

  const visibleSections = useMemo(() => {
    const sections: Array<{
      key: string;
      title: string;
      docs: EformsignDocument[];
      category: ContractCategory;
    }> = [];

    const actionNeeded = [...grouped["in-progress"], ...grouped.drafting];

    const includeAll = activeFilter === "전체";

    if ((includeAll || activeFilter === "검토 필요" || activeFilter === "대기") && actionNeeded.length > 0) {
      sections.push({
        key: "action-needed",
        title: `조치 필요 · ${actionNeeded.length}건`,
        docs: actionNeeded.filter((doc) => {
          if (activeFilter === "검토 필요") return categorize(doc) === "in-progress";
          if (activeFilter === "대기") return categorize(doc) === "drafting";
          return true;
        }),
        category: "in-progress",
      });
    }

    if ((includeAll || activeFilter === "완료") && grouped.completed.length > 0) {
      sections.push({
        key: "completed",
        title: `완료 · 최근 ${grouped.completed.length}건`,
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
  }, [grouped, activeFilter]);

  const totalDocs = useMemo(
    () =>
      (allData?.documents ?? []).filter((doc) => !EXCLUDED_CUSTOMER_NAMES.includes(customerName(doc))).length,
    [allData?.documents],
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
                {searchQuery.trim() || activeFilter !== "전체"
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
                    const meta = mapStatusToLabel(doc.current_status?.status_type) ?? tones.badge;
                    const name = doc.document_name || customerName(doc);

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
