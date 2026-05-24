"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleAlert, FileCheck2, FileText, MessageCircle, SquarePen, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useEformsignDocumentsByType, eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import { useEformsign } from "@/hooks/useEformsign";
import { EformsignDocument } from "@/lib/eformsign/types";
import type { EformsignDocumentOption } from "@/lib/eformsign/types";
import {
  getStatusCategory,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";
import {
  CONTRACT_FINALIZE_PROGRESS_STEPS,
  INITIAL_HEADLESS_PROGRESS,
  createHeadlessProgressId,
  getSafeHeadlessFailureMessage,
  isHeadlessProgressStepKey,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
} from "@/lib/eformsign/headless-progress";
import { HeadlessProgressModal } from "@/components/app/eformsign/HeadlessProgressModal";
import { eformsignApi } from "@/services/api";
import { Badge, ListCard } from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

const STAFF_COMPLETION_IFRAME_ID = "contracts_staff_completion_iframe";

type ContractCategory = "in-progress" | "drafting" | "completed" | "rejected";
type FilterKey = "전체" | "대기" | "검토 필요" | "완료" | "기간 만료";
type DetailTabId = "basic" | "signers" | "alimtalk";

const EXCLUDED_CUSTOMER_NAMES: string[] = [];
const CONTRACT_ROUTE_BODY_CLASS = "mobile-contracts-route";
const FILTER_LABELS: FilterKey[] = ["전체", "대기", "검토 필요", "완료", "기간 만료"];
const INITIAL_VISIBLE_COUNT = 6;
const LOAD_MORE_PAGE_SIZE = 6;

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
  // 모든 step recipient가 내부자(recipient_type "01")면 staff 최종 확인 대기 → "검토 필요" (in-progress).
  // 외부 서명자가 남아있으면 → "대기" (drafting bucket: 외부 서명 대기).
  const recipients = doc.current_status?.step_recipients ?? [];
  if (recipients.length > 0 && recipients.every((r) => r.recipient_type === "01")) {
    return "in-progress";
  }
  return "drafting";
}

// 모든 step recipients가 내부자(recipient_type "01")면 외부 서명은 끝났고 staff 최종 확인 대기.
function isReviewNeeded(doc: EformsignDocument): boolean {
  if (categorize(doc) !== "in-progress") return false;
  const recipients = doc.current_status?.step_recipients ?? [];
  if (recipients.length === 0) return false;
  return recipients.every((r) => r.recipient_type === "01");
}

function yymmddToIsoDate(value: string): string {
  const v = value.replace(/\D/g, "");
  if (v.length !== 6) return "";
  return `20${v.slice(0, 2)}-${v.slice(2, 4)}-${v.slice(4, 6)}`;
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

  const stepIndex = Number(doc.current_status?.step_index ?? 0);
  if (!Number.isFinite(stepIndex) || stepIndex <= 0) return 0;
  return Math.min(Math.max(stepIndex - 1, 0), total);
}

function progressLabel(doc: EformsignDocument): string {
  const category = categorize(doc);
  const total = recipientTotal(doc);
  const done = completedStepCount(doc, category);

  if (category === "completed") return `완료 · ${total}/${total}`;
  if (category === "rejected") return "기간 만료";
  if (category === "drafting") return `서명 대기 · ${done}/${total}`;
  return `검토 대기 · ${done}/${total}`;
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
  onFinalize,
}: {
  doc: EformsignDocument;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
  onFinalize?: (doc: EformsignDocument) => void;
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
        {isReviewNeeded(doc) && onFinalize ? (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => onFinalize(doc)}
            data-component="mobile-contracts-finalize"
          >
            확인하기
          </button>
        ) : (
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setActionStatus(`${name} 서명 화면을 엽니다.`)}
            data-component="mobile-contracts-sign"
          >
            지금 서명
          </button>
        )}
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

  // Finalize (mode:"02" — staff completion) flow state
  const queryClient = useQueryClient();
  const { isLoaded: isEformsignLoaded, openDocument } = useEformsign();
  const [finalizeDoc, setFinalizeDoc] = useState<EformsignDocument | null>(null);
  const [finalizeEndDateInput, setFinalizeEndDateInput] = useState("");
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = useState(false);
  const [isFinalizeSubmitting, setIsFinalizeSubmitting] = useState(false);
  const [finalizeProgress, setFinalizeProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [isFinalizeProgressOpen, setIsFinalizeProgressOpen] = useState(false);
  const [finalizeErrorHint, setFinalizeErrorHint] = useState<string | null>(null);
  const [isStaffIframeOpen, setIsStaffIframeOpen] = useState(false);
  const [staffDocumentOption, setStaffDocumentOption] = useState<EformsignDocumentOption | null>(null);
  const [finalizeFeedback, setFinalizeFeedback] = useState<string | null>(null);
  const finalizeProgressSourceRef = useRef<EventSource | null>(null);

  useEffect(() => () => {
    finalizeProgressSourceRef.current?.close();
  }, []);

  // When iframe option is set, open the iframe + invoke SDK
  useEffect(() => {
    if (!isStaffIframeOpen || !staffDocumentOption || !isEformsignLoaded) return;
    const handle = setTimeout(() => {
      openDocument(staffDocumentOption, STAFF_COMPLETION_IFRAME_ID, {
        onSuccess: () => {
          setIsStaffIframeOpen(false);
          setStaffDocumentOption(null);
          setFinalizeDoc(null);
          setFinalizeEndDateInput("");
          setFinalizeFeedback("계약서가 완료 처리되었습니다.");
          queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          [2000, 5000].forEach((delay) => {
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
            }, delay);
          });
        },
        onError: (response) => {
          setIsStaffIframeOpen(false);
          setStaffDocumentOption(null);
          setFinalizeFeedback(`최종 확인 실패: ${response.message ?? "알 수 없는 오류"}`);
        },
        onAction: (response) => {
          const t = response.type?.toLowerCase() ?? "";
          if (t.includes("cancel") || t.includes("close")) {
            setIsStaffIframeOpen(false);
            setStaffDocumentOption(null);
          }
        },
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [isStaffIframeOpen, staffDocumentOption, isEformsignLoaded, openDocument, queryClient]);

  const openFinalize = (doc: EformsignDocument) => {
    setFinalizeDoc(doc);
    setFinalizeEndDateInput("");
    setFinalizeErrorHint(null);
    setFinalizeProgress(INITIAL_HEADLESS_PROGRESS);
    setIsFinalizeDialogOpen(true);
  };

  const closeFinalizeDialog = () => {
    setIsFinalizeDialogOpen(false);
  };

  const handleFinalizeSubmit = async () => {
    if (!finalizeDoc) return;
    const endDateIso = yymmddToIsoDate(finalizeEndDateInput);
    if (!endDateIso) {
      setFinalizeErrorHint("서비스 종료일을 6자리(YYMMDD)로 입력해주세요.");
      return;
    }

    setIsFinalizeSubmitting(true);
    setFinalizeErrorHint(null);
    setIsFinalizeDialogOpen(false);
    setFinalizeProgress({ step: "client-started", completed: false, failed: false });
    setIsFinalizeProgressOpen(true);

    const documentId = finalizeDoc.id;
    const progressId = createHeadlessProgressId("finalize");
    let progressSource: EventSource | null = null;
    let headlessOk = false;

    try {
      progressSource = new EventSource(
        `/api/eformsign-docs/finalize-headless/progress?progressId=${encodeURIComponent(progressId)}`,
      );
      finalizeProgressSourceRef.current = progressSource;
      progressSource.addEventListener("progress", (event) => {
        let data: HeadlessProgressEvent;
        try { data = JSON.parse((event as MessageEvent).data) as HeadlessProgressEvent; }
        catch { return; }
        if (data.step === "failed") {
          setFinalizeErrorHint(getSafeHeadlessFailureMessage(data.reason));
          setFinalizeProgress((current) => ({
            step: data.failedStep && isHeadlessProgressStepKey(data.failedStep, CONTRACT_FINALIZE_PROGRESS_STEPS)
              ? data.failedStep
              : current.step ?? "client-started",
            completed: false,
            failed: true,
          }));
          return;
        }
        if (!isHeadlessProgressStepKey(data.step, CONTRACT_FINALIZE_PROGRESS_STEPS)) return;
        const nextStep = data.step;
        setFinalizeProgress((current) =>
          current.failed
            ? current
            : { step: nextStep, completed: nextStep === "sent", failed: false },
        );
      });

      const headless = await eformsignApi.finalizeHeadless(documentId, endDateIso, progressId);

      if (headless.ok) {
        headlessOk = true;
        setFinalizeProgress({ step: "sent", completed: true, failed: false });
        queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
        [2000, 5000].forEach((delay) => {
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
          }, delay);
        });
        setTimeout(() => {
          setIsFinalizeProgressOpen(false);
          setFinalizeFeedback("계약서가 완료 처리되었습니다.");
          setFinalizeDoc(null);
          setFinalizeEndDateInput("");
        }, 800);
        return;
      }

      console.warn("[finalize] headless ok=false", headless.reason);
      setFinalizeErrorHint(getSafeHeadlessFailureMessage(headless.reason));
      setFinalizeProgress((current) => ({
        step: headless.failedStep && isHeadlessProgressStepKey(headless.failedStep, CONTRACT_FINALIZE_PROGRESS_STEPS)
          ? (headless.failedStep as HeadlessProgressState["step"])
          : current.step ?? "client-started",
        completed: false,
        failed: true,
      }));
    } catch (err) {
      console.warn("[finalize] headless threw", err);
      setFinalizeErrorHint(getSafeHeadlessFailureMessage(err instanceof Error ? err.message : undefined));
      setFinalizeProgress((current) => ({ ...current, failed: true }));
    } finally {
      progressSource?.close();
      finalizeProgressSourceRef.current = null;
    }

    if (!headlessOk) {
      // Fallback to iframe via generateStaffDocument
      setIsFinalizeProgressOpen(false);
      try {
        const authResult = await eformsignApi.authenticate(Date.now());
        if (!authResult.success) throw new Error("eformsign 인증에 실패했습니다.");
        const option = await eformsignApi.generateStaffDocument(documentId, undefined, undefined, endDateIso);
        setStaffDocumentOption(option as EformsignDocumentOption);
        setIsStaffIframeOpen(true);
      } catch (fallbackErr) {
        const msg = fallbackErr instanceof Error ? fallbackErr.message : "최종 확인 준비 중 오류가 발생했습니다.";
        setFinalizeFeedback(msg);
      }
    }

    setIsFinalizeSubmitting(false);
  };

  // Auto-clear finalize feedback after 4s
  useEffect(() => {
    if (!finalizeFeedback) return;
    const handle = setTimeout(() => setFinalizeFeedback(null), 4000);
    return () => clearTimeout(handle);
  }, [finalizeFeedback]);

  useEffect(() => {
    document.body.classList.add(CONTRACT_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(CONTRACT_ROUTE_BODY_CLASS);
    };
  }, []);

  const { isAuthenticated } = useEformsignAuth();
  const { data: allData } = useEformsignDocumentsByType(isAuthenticated, null);

  const allDocuments = useMemo(
    () => (allData?.documents ?? []).filter((doc) => !EXCLUDED_CUSTOMER_NAMES.includes(customerName(doc))),
    [allData?.documents],
  );

  const grouped = useMemo(() => {
    const groups: Record<ContractCategory, EformsignDocument[]> = {
      "in-progress": [],
      drafting: [],
      completed: [],
      rejected: [],
    };
    for (const doc of allDocuments) {
      groups[categorize(doc)].push(doc);
    }
    return groups;
  }, [allDocuments]);

  const filterItems = useMemo(() => {
    const counts: Record<FilterKey, number> = {
      전체: allDocuments.length,
      대기: grouped.drafting.length,
      "검토 필요": grouped["in-progress"].length,
      완료: grouped.completed.length,
      "기간 만료": grouped.rejected.length,
    };
    return FILTER_LABELS.map((label) => ({ label, count: String(counts[label]) }));
  }, [allDocuments.length, grouped]);

  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT);
  }, [activeFilter]);

  const visibleSections = useMemo(() => {
    const sections: Array<{
      key: string;
      title: string;
      docs: EformsignDocument[];
      fullCount: number;
      category: ContractCategory;
    }> = [];

    const includeAll = activeFilter === "전체";
    const inProgressDocs = grouped["in-progress"];
    const primaryReviewDocs = includeAll ? inProgressDocs.slice(0, 1) : inProgressDocs;
    const progressDocs = includeAll ? inProgressDocs.slice(primaryReviewDocs.length) : [];
    const actionNeededAll = [...primaryReviewDocs, ...grouped.drafting].filter((doc) => {
      if (activeFilter === "검토 필요") return categorize(doc) === "in-progress";
      if (activeFilter === "대기") return categorize(doc) === "drafting";
      return true;
    });

    if ((includeAll || activeFilter === "검토 필요" || activeFilter === "대기") && actionNeededAll.length > 0) {
      sections.push({
        key: "action-needed",
        title: `조치 필요 · ${actionNeededAll.length}건`,
        docs: actionNeededAll.slice(0, visibleCount),
        fullCount: actionNeededAll.length,
        category: "in-progress",
      });
    }

    if (includeAll && progressDocs.length > 0) {
      sections.push({
        key: "in-progress",
        title: "진행 중",
        docs: progressDocs.slice(0, visibleCount),
        fullCount: progressDocs.length,
        category: "in-progress",
      });
    }

    if ((includeAll || activeFilter === "완료") && grouped.completed.length > 0) {
      sections.push({
        key: "completed",
        title: "완료 · 최근",
        docs: grouped.completed.slice(0, visibleCount),
        fullCount: grouped.completed.length,
        category: "completed",
      });
    }

    if ((includeAll || activeFilter === "기간 만료") && grouped.rejected.length > 0) {
      sections.push({
        key: "rejected",
        title: `기간 만료/반려 · ${grouped.rejected.length}건`,
        docs: grouped.rejected.slice(0, visibleCount),
        fullCount: grouped.rejected.length,
        category: "rejected",
      });
    }

    return sections.filter((s) => s.docs.length > 0);
  }, [grouped, activeFilter, visibleCount]);

  const hasMore = useMemo(
    () => visibleSections.some((s) => s.fullCount > s.docs.length),
    [visibleSections],
  );

  // 첫 teaser 단계에는 버튼만 노출 — 사용자가 "탭하여 더보기"를 한 번 누른 뒤부터 IntersectionObserver 활성화.
  const isInitialLoad = visibleCount === INITIAL_VISIBLE_COUNT;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore || isInitialLoad) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((current) => current + LOAD_MORE_PAGE_SIZE);
        }
      },
      { rootMargin: "0px 0px 120px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, isInitialLoad]);

  const totalDocs = allDocuments.length;

  const mainSheet = (
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
              <>
                {visibleSections.map((section) => (
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
                ))}
                {hasMore && isInitialLoad ? (
                  <div className="flex justify-center py-4">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((current) => current + LOAD_MORE_PAGE_SIZE)}
                      className="peek-bounce flex flex-col items-center gap-0.5 text-v3-primary"
                      data-component="mobile-contracts-load-more-button"
                      aria-label="더 많은 계약서 불러오기"
                    >
                      <span className="text-[0.78rem] font-bold">탭하여 더보기</span>
                      <ChevronDown size={20} strokeWidth={2.5} />
                    </button>
                  </div>
                ) : null}
                {hasMore && !isInitialLoad ? (
                  <div
                    ref={sentinelRef}
                    className="h-1"
                    aria-hidden="true"
                    data-component="mobile-contracts-load-sentinel"
                  />
                ) : null}
              </>
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
            onFinalize={openFinalize}
          />
        ) : (
          <div className="detail-body" />
        )
      }
    />
  );

  return (
    <>
      {mainSheet}

      {isFinalizeDialogOpen && finalizeDoc ? (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-6" data-component="mobile-contracts-finalize-dialog">
          <div className="w-full max-w-[360px] rounded-2xl bg-white p-5 shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
            <h2 className="mb-1 text-base font-extrabold text-v3-dark">최종 확인</h2>
            <p className="mb-4 text-[0.72rem] text-v3-text-muted">
              계약을 완료 처리하기 전에 서비스 종료일을 확인해주세요.
            </p>
            <label className="mb-1.5 block text-[0.7rem] font-bold uppercase tracking-wide text-v3-text-muted">
              서비스 종료일
            </label>
            <input
              className="box-border w-full rounded-xl border-[1.5px] border-v3-border bg-white px-3.5 py-3 text-[0.9rem] text-v3-dark outline-none focus:border-v3-primary"
              value={finalizeEndDateInput}
              onChange={(e) => setFinalizeEndDateInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              maxLength={6}
              placeholder="YYMMDD"
              autoFocus
            />
            {finalizeErrorHint ? (
              <div className="mt-2 text-[0.72rem] font-semibold text-v3-burgundy">
                {finalizeErrorHint}
              </div>
            ) : null}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-xl bg-[hsl(220_20%_97%)] py-3 text-[0.88rem] font-bold text-v3-text"
                onClick={closeFinalizeDialog}
                disabled={isFinalizeSubmitting}
              >
                취소
              </button>
              <button
                type="button"
                className="flex-[2] rounded-xl bg-v3-primary py-3 text-[0.88rem] font-bold text-white shadow-[0_4px_14px_rgba(20,50,100,0.18)] disabled:opacity-45"
                onClick={handleFinalizeSubmit}
                disabled={isFinalizeSubmitting}
              >
                {isFinalizeSubmitting ? "처리 중..." : "완료"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <HeadlessProgressModal
        open={isFinalizeProgressOpen}
        title="최종 확인 처리 중"
        steps={CONTRACT_FINALIZE_PROGRESS_STEPS}
        progress={finalizeProgress}
        errorHint={finalizeErrorHint}
        dataComponentPrefix="mobile-contracts-finalize-progress"
      />

      {isStaffIframeOpen ? (
        <div className="fixed inset-0 z-[200] flex flex-col bg-[hsl(var(--v3-dim-white))]" data-component="mobile-contracts-staff-iframe-modal">
          <div className="flex h-14 items-center justify-between border-b border-v3-border bg-white px-4 text-base font-bold text-v3-dark">
            <span>계약서 최종 확인</span>
            <button
              type="button"
              onClick={() => setIsStaffIframeOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-v3-text"
              aria-label="닫기"
            >
              <X size={20} strokeWidth={2.5} />
            </button>
          </div>
          <iframe
            id={STAFF_COMPLETION_IFRAME_ID}
            className="w-full flex-1 border-0 bg-white"
            title="staff completion"
          />
        </div>
      ) : null}

      {finalizeFeedback ? (
        <div
          className="fixed right-4 top-[calc(env(safe-area-inset-top)+1rem)] z-[1001] max-w-[320px] overflow-hidden rounded-2xl bg-v3-primary px-4 py-3 text-[0.8rem] font-semibold text-white shadow-[0_8px_24px_rgba(20,50,100,0.25)]"
          role="status"
          data-component="mobile-contracts-finalize-feedback"
        >
          {finalizeFeedback}
        </div>
      ) : null}
    </>
  );
}
