"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Send,
  Calendar,
  User,
  FileSignature,
  Mail,
  Eye,
} from "lucide-react";
import { useEformsignDocumentsByType } from "@/app/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/app/hooks/useEformsignAuth";
import { EformsignDocument } from "@/app/lib/eformsign/types";
import {
  DocumentFilterType,
  mapStatusToLabel,
  getStatusCategory,
} from "@/app/lib/eformsign/status-codes";
import {
  PageHeader,
  StatMini,
  SplitLayout,
  ListPanel,
  DetailPanel,
  StatusBadge,
  InfoCard,
  InfoRow,
  ActivityTimeline,
} from "@/app/(components)/v3";
import type { StatusType } from "@/app/(components)/v3";

const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];

const TAB_ITEMS = [
  { label: "전체", value: "all" },
  { label: "대기", value: "in-progress" },
  { label: "완료", value: "completed" },
  { label: "만료", value: "rejected" },
];

function getCustomerName(doc: EformsignDocument): string | null {
  const recipients = doc.current_status?.step_recipients;
  if (recipients && recipients.length > 0 && recipients[0]?.name) {
    return recipients[0].name;
  }
  if (doc.last_editor?.name) return doc.last_editor.name;
  if (doc.creator?.name) return doc.creator.name;
  return null;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapCategoryToStatusType(category: "completed" | "rejected" | "in-progress"): StatusType {
  switch (category) {
    case "completed":
      return "signed";
    case "rejected":
      return "expired";
    case "in-progress":
      return "pending";
  }
}

function mapCategoryToBannerStyle(category: "completed" | "rejected" | "in-progress") {
  switch (category) {
    case "completed":
      return "bg-v3-green-light text-v3-green border border-v3-green/20";
    case "rejected":
      return "bg-v3-burgundy-light text-v3-burgundy border border-v3-burgundy/20";
    case "in-progress":
      return "bg-v3-orange-light text-v3-orange border border-v3-orange/20";
  }
}

function mapCategoryToLabel(category: "completed" | "rejected" | "in-progress"): string {
  switch (category) {
    case "completed":
      return "서명 완료";
    case "rejected":
      return "만료 / 거부";
    case "in-progress":
      return "서명 대기중";
  }
}

function getSignatureProgress(category: "completed" | "rejected" | "in-progress") {
  const steps = [
    { label: "문서 생성", done: true },
    { label: "발송 완료", done: true },
    { label: "서명 대기", done: category === "completed" || category === "in-progress" },
    { label: "계약 완료", done: category === "completed" },
  ];
  return steps;
}

export default function ContractsPage() {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth();
  const filterType: DocumentFilterType = activeTab === "all" ? null : (activeTab as DocumentFilterType);
  const { data, isLoading, error } = useEformsignDocumentsByType(isAuthenticated, filterType);

  const isInitialLoading = isLoadingAuth || isLoading;

  const documents = useMemo(() => {
    return (data?.documents || []).filter((doc) => {
      const name = getCustomerName(doc);
      if (!name) return false;
      if (EXCLUDED_CUSTOMER_NAMES.includes(name)) return false;
      return true;
    });
  }, [data?.documents]);

  const { data: allData } = useEformsignDocumentsByType(isAuthenticated, null);

  const stats = useMemo(() => {
    const allDocs = (allData?.documents || []).filter((doc) => {
      const name = getCustomerName(doc);
      return name && !EXCLUDED_CUSTOMER_NAMES.includes(name);
    });

    let pending = 0;
    let completed = 0;
    let expired = 0;

    for (const doc of allDocs) {
      const cat = getStatusCategory(doc.current_status?.status_type);
      if (cat === "in-progress") pending++;
      else if (cat === "completed") completed++;
      else if (cat === "rejected") expired++;
    }

    return { total: allDocs.length, pending, completed, expired };
  }, [allData?.documents]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return documents[0] ?? null;
    return documents.find((d) => d.id === selectedDocId) ?? documents[0] ?? null;
  }, [selectedDocId, documents]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSelectedDocId(null);
  };

  if (authError || error) {
    return (
      <div className="p-6">
        <div className="bg-v3-burgundy-light text-v3-burgundy rounded-[18px] p-6 text-center">
          {authError
            ? "인증에 실패했습니다. 페이지를 새로고침 해주세요."
            : "문서를 불러오는데 실패했습니다."}
        </div>
      </div>
    );
  }

  return (
    <section data-component="contracts" className="space-y-6">
        <PageHeader
          title="전자계약 관리"
          subtitle="eformsign 전자계약 문서를 관리합니다"
          icon={FileText}
          actions={
            <Link
              href="/contracts/creation"
              data-component="contracts-header-send-contract"
              className="inline-flex items-center gap-2 rounded-[14px] bg-v3-primary px-5 py-2.5 text-[0.85rem] font-semibold text-white shadow-v3 hover:shadow-v3-hover hover:-translate-y-0.5 transition-all duration-300"
            >
              <Plus className="h-4 w-4" />
              서명 요청
            </Link>
          }
        />

        <div data-component="contracts-stats" className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatMini
            icon={FileText}
            value={isInitialLoading ? "–" : stats.total}
            label="전체 계약"
            colorIndex={0}
          />
          <StatMini
            icon={Clock}
            value={isInitialLoading ? "–" : stats.pending}
            label="대기중"
            colorIndex={1}
          />
          <StatMini
            icon={CheckCircle2}
            value={isInitialLoading ? "–" : stats.completed}
            label="서명완료"
            colorIndex={2}
          />
          <StatMini
            icon={AlertTriangle}
            value={isInitialLoading ? "–" : stats.expired}
            label="만료"
            colorIndex={3}
          />
        </div>

        <SplitLayout>
          <ListPanel
            title="계약 목록"
            tabs={TAB_ITEMS}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          >
            {isInitialLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-16 rounded-[14px] bg-v3-dim-white animate-pulse"
                  />
                ))}
              </div>
            ) : documents.length === 0 ? (
              <div className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                계약 문서가 없습니다
              </div>
            ) : (
              <div data-component="contracts-list-items" className="space-y-1">
                {documents.map((doc) => {
                  const customerName = getCustomerName(doc);
                  const category = getStatusCategory(doc.current_status?.status_type);
                  const statusType = mapCategoryToStatusType(category);
                  const statusLabel = mapStatusToLabel(doc.current_status?.status_type);
                  const isActive = selectedDocument?.id === doc.id;

                  return (
                    <button
                      key={doc.id}
                      data-component="contracts-list-item"
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-[14px] text-left transition-all duration-200 ${
                        isActive
                          ? "bg-v3-primary-light border-l-2 border-v3-primary"
                          : "hover:bg-v3-dim-white"
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 ${
                          category === "completed"
                            ? "bg-v3-green-light"
                            : category === "rejected"
                              ? "bg-v3-burgundy-light"
                              : "bg-v3-orange-light"
                        }`}
                      >
                        <FileSignature
                          className={`w-4 h-4 ${
                            category === "completed"
                              ? "text-v3-green"
                              : category === "rejected"
                                ? "text-v3-burgundy"
                                : "text-v3-orange"
                          }`}
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-[0.8rem] font-semibold text-v3-dark truncate">
                          {doc.document_name}
                        </p>
                        <p className="text-[0.7rem] text-v3-text-muted truncate">
                          {customerName}
                        </p>
                      </div>

                      <StatusBadge status={statusType} label={statusLabel} />
                    </button>
                  );
                })}
              </div>
            )}
          </ListPanel>

          {selectedDocument ? (
            <ContractDetail document={selectedDocument} />
          ) : (
            <div className="bg-white rounded-[28px] shadow-v3 flex items-center justify-center min-h-[400px]">
              <div className="text-center text-v3-text-muted">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-[0.85rem]">계약을 선택해주세요</p>
              </div>
            </div>
          )}
        </SplitLayout>
    </section>
  );
}

function ContractDetail({ document: doc }: { document: EformsignDocument }) {
  const customerName = getCustomerName(doc) ?? "–";
  const category = getStatusCategory(doc.current_status?.status_type);
  const statusType = mapCategoryToStatusType(category);
  const statusLabel = mapStatusToLabel(doc.current_status?.status_type);
  const bannerStyle = mapCategoryToBannerStyle(category);
  const bannerLabel = mapCategoryToLabel(category);
  const steps = getSignatureProgress(category);

  const expiredDate = doc.current_status?.expired_date;

  const activityItems = useMemo(() => {
    const items: {
      icon: React.ComponentType<{ className?: string }>;
      iconVariant: "success" | "warning" | "info" | "danger";
      text: React.ReactNode;
      time: string;
    }[] = [];

    items.push({
      icon: FileText,
      iconVariant: "info",
      text: "문서가 생성되었습니다",
      time: formatDateTime(doc.created_date),
    });

    items.push({
      icon: Send,
      iconVariant: "info",
      text: `${customerName}에게 발송되었습니다`,
      time: formatDateTime(doc.created_date),
    });

    if (category === "completed") {
      items.push({
        icon: CheckCircle2,
        iconVariant: "success",
        text: "서명이 완료되었습니다",
        time: formatDateTime(doc.updated_date),
      });
    } else if (category === "rejected") {
      items.push({
        icon: AlertTriangle,
        iconVariant: "danger",
        text: "문서가 거부/만료되었습니다",
        time: formatDateTime(doc.updated_date),
      });
    } else {
      items.push({
        icon: Eye,
        iconVariant: "warning",
        text: "서명 대기중입니다",
        time: "현재",
      });
    }

    return items;
  }, [doc, customerName, category]);

  const header = (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-v3-dark truncate">
            {doc.document_name}
          </h2>
          <div className="flex items-center gap-4 mt-1 text-[0.75rem] text-v3-text-muted">
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              발송일: {formatDate(doc.created_date)}
            </span>
            {expiredDate && expiredDate > 0 && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                만료일: {formatDate(expiredDate)}
              </span>
            )}
          </div>
        </div>
        <StatusBadge status={statusType} label={statusLabel} />
      </div>

      <div className={`rounded-[14px] px-4 py-3 text-[0.8rem] font-semibold ${bannerStyle}`}>
        {bannerLabel}
      </div>
    </div>
  );

  return (
    <DetailPanel header={header}>
      <div data-component="contracts-detail" className="space-y-5">
        <InfoCard title="고객 정보">
          <InfoRow
            label="고객명"
            value={
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-v3-text-muted" />
                {customerName}
              </span>
            }
          />
          {doc.current_status?.step_recipients?.[0]?.sms && (
            <InfoRow label="연락처" value={doc.current_status.step_recipients[0].sms} />
          )}
          {doc.current_status?.step_recipients?.[0]?.id && (
            <InfoRow
              label="이메일"
              value={
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-v3-text-muted" />
                  {doc.current_status.step_recipients[0].id}
                </span>
              }
            />
          )}
        </InfoCard>

        <InfoCard title="계약 정보">
          <InfoRow label="문서명" value={doc.document_name} />
          <InfoRow label="템플릿" value={doc.template?.name ?? "–"} />
          <InfoRow label="문서번호" value={doc.document_number ?? "–"} />
          <InfoRow label="작성일" value={formatDate(doc.created_date)} />
          <InfoRow label="최종수정" value={formatDate(doc.updated_date)} />
        </InfoCard>

        <InfoCard title="서명 진행 상태">
          <div className="flex items-center gap-0 py-2">
            {steps.map((step, idx) => (
              <div key={step.label} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[0.65rem] font-bold ${
                      step.done
                        ? "bg-v3-primary text-white"
                        : "bg-v3-dim-white text-v3-text-muted"
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <span className="text-[0.6rem] text-v3-text-muted mt-1 whitespace-nowrap">
                    {step.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`w-8 h-0.5 mx-1 mt-[-12px] ${
                      steps[idx + 1].done ? "bg-v3-primary" : "bg-v3-border"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </InfoCard>

        <InfoCard title="활동 기록">
          <ActivityTimeline items={activityItems} maxHeight="300px" />
        </InfoCard>
      </div>
    </DetailPanel>
  );
}
