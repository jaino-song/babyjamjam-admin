"use client";

import { useMemo, useState } from "react";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  MoreVertical,
  Plus,
  Send,
  Calendar,
  User,
  FileSignature,
  Mail,
  Eye,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useDeleteEformsignDocument, useEformsignDocumentsByType } from "@/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import { EformsignDocument } from "@/lib/eformsign/types";
import {
  DocumentFilterType,
  mapStatusToLabel,
  getStatusCategory,
} from "@/lib/eformsign/status-codes";
import {
  StatsBar,
  SplitLayout,
  ListPanel,
  DetailPanel,
  StatusBadge,
  InfoCard,
  InfoRow,
  ActivityTimeline,
  AnimatedSlotList,
  HeaderActionButton,
  Stepper,
  EmptyState,
  DetailSkeleton,
  ListEmptyState,
} from "@/components/app/v3";
import type { StatusType } from "@/components/app/v3";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  const [deleteTargetDocumentId, setDeleteTargetDocumentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRetrying, setIsRetrying] = useState(false);

  const { isAuthenticated, isLoading: isLoadingAuth, error: authError, authenticate } = useEformsignAuth();
  const { toast } = useToast();
  const deleteDocument = useDeleteEformsignDocument();
  const filterType: DocumentFilterType = activeTab === "all" ? null : (activeTab as DocumentFilterType);

  const { data: allData, isLoading: isLoadingAll, refetch: refetchAll } = useEformsignDocumentsByType(isAuthenticated, null);

  // Fetch filtered docs with infinite scroll for the current tab
  const {
    documents: infiniteDocuments,
    isLoading: isLoadingInfinite,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    isInitialLoad,
    error,
    refetch: refetchInfinite,
  } = useInfiniteContracts({
    enabled: isAuthenticated,
    filterType,
    excludedNames: EXCLUDED_CUSTOMER_NAMES,
  });

  // Initial loading: auth or first "all" data fetch
  const isInitialLoading = isLoadingAuth || isLoadingAll;
  // Content loading: fetching filtered data after initial load is complete
  const isContentLoading = !isInitialLoading && isLoadingInfinite;

  // Use infinite scroll documents, with optional local search filter
  const documents = useMemo(() => {
    if (!searchQuery.trim()) return infiniteDocuments;
    return infiniteDocuments.filter((doc) => {
      const customerName = getCustomerName(doc);
      const q = searchQuery.trim();
      if (customerName && matchesKoreanSearch(customerName, q)) return true;
      if (doc.document_name?.toLowerCase().includes(q.toLowerCase())) return true;
      return false;
    });
  }, [infiniteDocuments, searchQuery]);

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
    if (!selectedDocId) return null;
    return documents.find((d) => d.id === selectedDocId) ?? null;
  }, [selectedDocId, documents]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSelectedDocId(null);
  };

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      await authenticate();
      await Promise.all([refetchAll(), refetchInfinite()]);
    } catch {
    } finally {
      setIsRetrying(false);
    }
  };

  const handleDeleteRequest = (documentId: string) => {
    setDeleteTargetDocumentId(documentId);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetDocumentId == null) {
      return;
    }

    try {
      const response = await deleteDocument.mutateAsync(deleteTargetDocumentId);
      const deleted = response.result?.success_result?.includes(deleteTargetDocumentId);

      if (!deleted) {
        const failedItem = response.result?.fail_result?.find((item) => item.document_id === deleteTargetDocumentId);
        throw new Error(failedItem?.message || "문서 삭제에 실패했습니다.");
      }

      if (selectedDocId === deleteTargetDocumentId) {
        setSelectedDocId(null);
      }
      setDeleteTargetDocumentId(null);
      toast({
        title: "문서 삭제 완료",
        description: "선택한 문서를 삭제했습니다.",
      });
    } catch (deleteError) {
      console.error("Failed to delete contract document:", deleteError);
      toast({
        title: "문서 삭제 실패",
        description:
          deleteError instanceof Error
            ? deleteError.message
            : "문서 삭제 중 오류가 발생했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  };

  if (authError || error) {
    return (
      <div className="p-6">
        <div className="bg-v3-burgundy-light text-v3-burgundy rounded-2xl p-6 text-center space-y-4">
          <p>
            {authError
              ? "인증에 실패했습니다."
              : "문서를 불러오는데 실패했습니다."}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-v3-burgundy text-white text-[0.85rem] font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isRetrying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                재시도 중...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                다시 시도
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section data-component="contracts" className="space-y-6">
      <StatsBar
        name="contracts"
        isLoading={isInitialLoading}
        items={[
          { icon: FileText, value: stats.total, label: "전체 계약", counter: "건" },
          { icon: Clock, value: stats.pending, label: "대기중", counter: "건", colorIndex: 1 },
          { icon: CheckCircle2, value: stats.completed, label: "서명완료", counter: "건", colorIndex: 2 },
          { icon: AlertTriangle, value: stats.expired, label: "만료", counter: "건", colorIndex: 3 },
        ]}
      />

      <SplitLayout hasSelection={!!selectedDocId} onBack={() => setSelectedDocId(null)} autoHeight>
        <ListPanel
          title="계약 목록"
          tabs={TAB_ITEMS}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="고객명, 문서명 검색..."
          isLoading={isInitialLoading || isContentLoading}
          headerActions={
            <HeaderActionButton
              href="/contracts/creation"
              icon={Plus}
              label="서명 요청"
              data-component="contracts-header-send-contract"
            />
          }
        >
          {documents.length === 0 && !isInitialLoading && !isContentLoading ? (
            <ListEmptyState message="계약 문서가 없습니다" />
          ) : (
            <AnimatedSlotList<EformsignDocument>
              items={documents}
              isLoading={isInitialLoading || isContentLoading}
              loadingCount={6}
              className="space-y-2"
              slotClassName={({ item, isLoading }) => {
                const isActive = !isLoading && item && selectedDocument?.id === item.id;
                return cn(
                  "flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 bg-white border-2 border-transparent",
                  !isLoading && "cursor-pointer",
                  isActive
                    ? "bg-v3-primary-light border-2 border-v3-primary"
                    : !isLoading && "hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                );
              }}
              onSlotClick={(doc) => setSelectedDocId(doc.id)}
              // Load more props
              hasMore={hasNextPage}
              onLoadMore={fetchNextPage}
              isFetchingMore={isFetchingNextPage}
              isInitialLoad={isInitialLoad}
              render={({ item: doc, isLoading }) => {
                // Skeleton state
                if (isLoading) {
                  return (
                    <>
                      <div className="w-11 h-11 rounded-2xl shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
                        <Skeleton className="w-5 h-5 rounded-2xl bg-white/70" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-40 bg-v3-dim-white" />
                      </div>
                      <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white shrink-0" />
                    </>
                  );
                }

                if (!doc) return null;
                const customerName = getCustomerName(doc);
                const category = getStatusCategory(doc.current_status?.status_type);
                const statusType = mapCategoryToStatusType(category);
                const statusLabel = mapStatusToLabel(doc.current_status?.status_type);

                return (
                  <>
                    <div
                      className={cn(
                        "w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-md",
                        category === "completed"
                          ? "bg-v3-green-light"
                          : category === "rejected"
                            ? "bg-v3-burgundy-light"
                            : "bg-v3-orange-light"
                      )}
                    >
                      <FileSignature
                        className={cn(
                          "w-5 h-5",
                          category === "completed"
                            ? "text-v3-green"
                            : category === "rejected"
                              ? "text-v3-burgundy"
                              : "text-v3-orange"
                        )}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                          {customerName}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[0.7rem] text-v3-text-muted truncate">
                        {doc.document_name}
                      </div>
                    </div>

                    <div className="shrink-0">
                      <StatusBadge status={statusType} label={statusLabel} />
                    </div>
                  </>
                );
              }}
            />
          )}
        </ListPanel>

        {isInitialLoading ? (
          <DetailSkeleton
            name="contracts-detail-skeleton"
            headerBadge
            headerBanner
            sections={[
              { titleWidth: "w-16", rows: ["w-1/2", "w-2/3"] },
              { titleWidth: "w-16", rows: ["w-3/4", "w-1/2", "w-2/3"] },
              { titleWidth: "w-20", rows: ["w-full"] },
            ]}
          />
        ) : selectedDocument ? (
          <ContractDetail document={selectedDocument} onDeleteRequest={handleDeleteRequest} />
        ) : (
          <EmptyState icon={FileText} message="계약을 선택해주세요" className="min-h-[400px]" />
        )}
      </SplitLayout>

      <ConfirmActionModal
        open={deleteTargetDocumentId != null}
        title="삭제"
        description="이 문서를 삭제하시겠습니까?"
        cancelLabel="취소"
        confirmLabel="삭제"
        loading={deleteDocument.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteDocument.isPending) {
            setDeleteTargetDocumentId(null);
          }
        }}
        onCancel={() => setDeleteTargetDocumentId(null)}
        onConfirm={handleDeleteConfirm}
      />
    </section>
  );
}

function ContractDetail({
  document: doc,
  onDeleteRequest,
}: {
  document: EformsignDocument;
  onDeleteRequest?: (documentId: string) => void;
}) {
  const customerName = getCustomerName(doc) ?? "–";
  const category = getStatusCategory(doc.current_status?.status_type);
  const statusType = mapCategoryToStatusType(category);
  const statusLabel = mapStatusToLabel(doc.current_status?.status_type);
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
        text: "문서가 만료되었습니다",
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
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-v3-dark truncate">
          {doc.document_name}
        </h2>
        <div className="flex items-center gap-4 mt-1 text-[0.75rem] text-v3-text-muted">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            발송일: {formatDate(doc.created_date)}
          </span>
          {expiredDate != null && expiredDate > 0 && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              만료일: {formatDate(expiredDate)}
            </span>
          )}
        </div>
        <div className="mt-2">
          <StatusBadge status={statusType} label={statusLabel} />
        </div>
      </div>

      <InfoCard title="서명 진행 상태">
        <Stepper steps={steps} className="py-2" />
      </InfoCard>
    </div>
  );

  return (
    <DetailPanel
      mobileActions={
        onDeleteRequest ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                data-component="contracts-detail-mobile-more-trigger"
                className="h-9 w-9 rounded-full text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
                aria-label="상세 액션 더보기"
              >
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              data-component="contracts-detail-mobile-more-content"
              align="end"
              sideOffset={8}
              avoidCollisions
              className="min-w-[8.5rem]"
            >
              <DropdownMenuItem
                data-component="contracts-detail-mobile-more-delete"
                variant="destructive"
                onClick={() => onDeleteRequest(doc.id)}
              >
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : undefined
      }
      header={header}
    >
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

        <InfoCard title="활동 기록">
          <ActivityTimeline items={activityItems} maxHeight="300px" />
        </InfoCard>

        {onDeleteRequest && (
          <div
            data-component="contracts-detail-actions"
            className="hidden lg:flex gap-3 pt-2"
          >
            <Button
              variant="outline"
              className="flex-1 rounded-full"
              onClick={() => onDeleteRequest(doc.id)}
            >
              삭제
            </Button>
          </div>
        )}
      </div>
    </DetailPanel>
  );
}
