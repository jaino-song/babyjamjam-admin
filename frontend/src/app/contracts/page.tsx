"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  Calendar,
  User,
  FileSignature,
  Mail,
  MoreVertical,
  Eye,
} from "lucide-react";
import {
  useDeleteEformsignDocument,
  useEformsignDocumentsByType,
} from "@/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import { EformsignDocument } from "@/lib/eformsign/types";
import {
  DocumentFilterType,
  mapStatusToLabel,
  getStatusCategory,
  normalizeStatusCode,
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
  PageSection,
  DetailSkeleton,
  ListEmptyState,
} from "@/components/app/v3";
import type { StatusType } from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { eformsignApi } from "@/services/api";
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

function normalizePhoneNumber(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.startsWith("0082")) return `0${digits.slice(4)}`;
  if (digits.startsWith("82")) return `0${digits.slice(2)}`;
  return digits;
}

function formatPhoneNumber(value: string): string {
  const digits = normalizePhoneNumber(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}

function isEmailAddress(value: string | null | undefined): boolean {
  return Boolean(value && value.includes("@"));
}

function getDocumentContactInfo(doc: EformsignDocument): { phone?: string; email?: string } {
  const currentRecipient = doc.current_status?.step_recipients?.[0];
  const currentRecipientPhone = currentRecipient?.sms?.trim();
  const currentRecipientId = currentRecipient?.id?.trim();

  if (currentRecipientPhone || currentRecipientId) {
    return {
      phone: currentRecipientPhone,
      email: isEmailAddress(currentRecipientId) ? currentRecipientId : undefined,
    };
  }

  const lastEditorId = doc.last_editor?.id?.trim();
  if (doc.last_editor?.recipient_type === "02" && lastEditorId) {
    return isEmailAddress(lastEditorId)
      ? { email: lastEditorId }
      : { phone: lastEditorId };
  }

  return {};
}

function canReRequestDocument(doc: EformsignDocument): boolean {
  return (
    getStatusCategory(doc.current_status?.status_type) === "in-progress" &&
    doc.current_status?.step_type === "05" &&
    Boolean(doc.current_status?.step_index)
  );
}

export default function ContractsPage() {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [deleteTargetDocumentId, setDeleteTargetDocumentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth();
  const { toast } = useToast();
  const deleteDocument = useDeleteEformsignDocument();
  const filterType: DocumentFilterType = activeTab === "all" ? null : (activeTab as DocumentFilterType);

  // Fetch all docs (for stats) - single request for total counts
  const { data: allData, isLoading: isLoadingAll } = useEformsignDocumentsByType(isAuthenticated, null);

  // Fetch filtered docs with infinite scroll for the current tab
  const {
    documents: infiniteDocuments,
    isLoading: isLoadingInfinite,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
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

    let completed = 0;
    let sendRequired = 0;
    let drafting = 0;
    let expired = 0;

    for (const doc of allDocs) {
      const normalizedStatus = normalizeStatusCode(doc.current_status?.status_type);
      const cat = getStatusCategory(doc.current_status?.status_type);

      if (cat === "completed") {
        completed++;
        continue;
      }

      if (cat === "rejected") {
        expired++;
        continue;
      }

      if (normalizedStatus === "001") {
        drafting++;
        continue;
      }

      sendRequired++;
    }

    return { completed, sendRequired, drafting, expired };
  }, [allData?.documents]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocId) return null;
    return documents.find((d) => d.id === selectedDocId) ?? null;
  }, [selectedDocId, documents]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSelectedDocId(null);
  };

  const handleDeleteRequest = (documentId: string) => {
    setDeleteTargetDocumentId(documentId);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetDocumentId == null) return;

    try {
      const response = await deleteDocument.mutateAsync(deleteTargetDocumentId);
      const deleted = response.result?.success_result?.includes(deleteTargetDocumentId);

      if (!deleted) {
        const failedItem = response.result?.fail_result?.find(
          (item) => item.document_id === deleteTargetDocumentId
        );
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
      <div data-component="contracts-error-container" className="p-6">
        <div data-component="contracts-error-banner" className="bg-v3-burgundy-light text-v3-burgundy rounded-[18px] p-6 text-center">
          {authError
            ? "인증에 실패했습니다. 페이지를 새로고침 해주세요."
            : "문서를 불러오는데 실패했습니다."}
        </div>
      </div>
    );
  }

  return (
    <PageSection name="contracts">
        <StatsBar
          name="contracts"
          isLoading={isInitialLoading}
          items={[
            { icon: CheckCircle2, value: stats.completed, label: "완료", counter: "건", colorIndex: 2 },
            { icon: Send, value: stats.sendRequired, label: "발송 필요", counter: "건", colorIndex: 1 },
            { icon: FileText, value: stats.drafting, label: "작성 대기중", counter: "건" },
            { icon: AlertTriangle, value: stats.expired, label: "기간 만료", counter: "건", colorIndex: 3 },
          ]}
        />

        <SplitLayout hasSelection={!!selectedDocument} onBack={() => setSelectedDocId(null)}>
          <ListPanel
            title="계약 목록"
            tabs={TAB_ITEMS}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="고객명, 문서명 검색..."
            isLoading={isInitialLoading}
            isContentLoading={isContentLoading}
            headerActions={
              <HeaderActionButton
                href="/contracts/creation"
                icon={Send}
                label="전자문서 발송"
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
                    "flex items-center gap-3 p-4 rounded-[18px] transition-all duration-200 bg-white border-2 border-transparent",
                    !isLoading && "cursor-pointer",
                    isActive
                      ? "bg-v3-primary-light border-2 border-v3-primary"
                      : !isLoading && "hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                  );
                }}
                onSlotClick={(doc) => setSelectedDocId(doc.id)}
                // Load more props
                hasMore={hasNextPage}
                onLoadMore={() => fetchNextPage()}
                isFetchingMore={isFetchingNextPage}
                render={({ item: doc, isLoading }) => {
                  // Skeleton state
                  if (isLoading) {
                    return (
                      <>
                        <div data-component="contracts-list-item-skeleton-icon" className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center">
                          <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
                        </div>
                        <div data-component="contracts-list-item-skeleton-content" className="flex-1 min-w-0">
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
                        data-component="contracts-list-item-icon"
                        className={cn(
                          "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 shadow-md",
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

                      <div data-component="contracts-list-item-content" className="flex-1 min-w-0">
                        <div data-component="contracts-list-item-title-row" className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                            {customerName}
                          </span>
                        </div>
                        <div data-component="contracts-list-item-subtitle" className="flex items-center gap-2 text-[0.7rem] text-v3-text-muted truncate">
                          {doc.document_name}
                        </div>
                      </div>

                      <div data-component="contracts-list-item-status" className="shrink-0">
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
            <ContractDetail
              key={selectedDocument.id}
              document={selectedDocument}
              onDeleteRequest={handleDeleteRequest}
            />
          ) : (
            <EmptyState icon={FileText} message="계약을 선택하면 상세 정보가 표시됩니다" />
          )}
        </SplitLayout>

      <Dialog
        open={deleteTargetDocumentId != null}
        onOpenChange={(open) => {
          if (!open && !deleteDocument.isPending) {
            setDeleteTargetDocumentId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>삭제</DialogTitle>
            <DialogDescription>이 문서를 삭제하시겠습니까?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTargetDocumentId(null)}
              disabled={deleteDocument.isPending}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleteDocument.isPending}
            >
              {deleteDocument.isPending ? "삭제 중..." : "삭제"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}

function ContractDetail({
  document: doc,
  onDeleteRequest,
}: {
  document: EformsignDocument;
  onDeleteRequest?: (documentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const customerName = getCustomerName(doc) ?? "–";
  const category = getStatusCategory(doc.current_status?.status_type);
  const statusType = mapCategoryToStatusType(category);
  const statusLabel = mapStatusToLabel(doc.current_status?.status_type);
  const steps = getSignatureProgress(category);
  const [isReRequestDialogOpen, setIsReRequestDialogOpen] = useState(false);
  const canReRequest = canReRequestDocument(doc);
  const reRequestStepType = doc.current_status?.step_type ?? "";
  const reRequestStepSeq = doc.current_status?.step_index ?? "";
  const currentRecipient = doc.current_status?.step_recipients?.[0];
  const contactInfo = getDocumentContactInfo(doc);
  const initialRecipientPhone = normalizePhoneNumber(currentRecipient?.sms);
  const [recipientPhone, setRecipientPhone] = useState(initialRecipientPhone);
  const recipientPhoneDigits = normalizePhoneNumber(recipientPhone);
  const hasEditedRecipientPhone = recipientPhoneDigits !== initialRecipientPhone;
  const isRecipientPhoneValid =
    !hasEditedRecipientPhone || (recipientPhoneDigits.length >= 10 && recipientPhoneDigits.length <= 11);

  const expiredDate = doc.current_status?.expired_date;

  const handleReRequestDialogChange = (open: boolean) => {
    setIsReRequestDialogOpen(open);

    if (!open) {
      setRecipientPhone(initialRecipientPhone);
    }
  };

  const reRequestMutation = useMutation({
    mutationFn: async () => {
      return eformsignApi.reRequestDocument(doc.id, {
        stepType: reRequestStepType,
        stepSeq: reRequestStepSeq,
        comment: "재요청입니다.",
        recipientPhone: hasEditedRecipientPhone
          ? {
              countryCode: "+82",
              phoneNumber: recipientPhoneDigits,
            }
          : undefined,
      });
    },
    onSuccess: () => {
      handleReRequestDialogChange(false);
      queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
      toast({
        description: `${customerName}님에게 전자문서 작성을 재요청했습니다.`,
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        description: error instanceof Error ? error.message : "재요청 중 오류가 발생했습니다.",
      });
    },
  });

  const activityItems: {
    icon: React.ComponentType<{ className?: string }>;
    iconVariant: "success" | "warning" | "info" | "danger";
    text: React.ReactNode;
    time: string;
  }[] = [
    {
      icon: FileText,
      iconVariant: "info",
      text: "문서가 생성되었습니다",
      time: formatDateTime(doc.created_date),
    },
    {
      icon: Send,
      iconVariant: "info",
      text: `${customerName}에게 발송되었습니다`,
      time: formatDateTime(doc.created_date),
    },
  ];

  if (category === "completed") {
    activityItems.push({
      icon: CheckCircle2,
      iconVariant: "success",
      text: "서명이 완료되었습니다",
      time: formatDateTime(doc.updated_date),
    });
  } else if (category === "rejected") {
    activityItems.push({
      icon: AlertTriangle,
      iconVariant: "danger",
      text: "문서가 거부/만료되었습니다",
      time: formatDateTime(doc.updated_date),
    });
  } else {
    activityItems.push({
      icon: Eye,
      iconVariant: "warning",
      text: "서명 대기중입니다",
      time: "현재",
    });
  }

  return (
    <DetailPanel
      title={doc.document_name}
      badges={<StatusBadge status={statusType} label={statusLabel} />}
      subtitle={
        <span className="flex items-center gap-4 text-[0.75rem]">
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
        </span>
      }
      trailing={
        <div data-component="contracts-stepper-actions" className="flex items-start gap-2">
          <Stepper steps={steps} />
          {(canReRequest || onDeleteRequest) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-component="contracts-detail-more-trigger"
                  className="h-9 w-9 rounded-full text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
                  aria-label="계약 작업 더보기"
                >
                  <MoreVertical className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                data-component="contracts-detail-more-content"
                align="end"
                sideOffset={8}
                className="min-w-[8rem]"
              >
                {canReRequest && (
                  <DropdownMenuItem
                    data-component="contracts-detail-more-rerequest"
                    onSelect={() => handleReRequestDialogChange(true)}
                  >
                    재요청
                  </DropdownMenuItem>
                )}
                {canReRequest && onDeleteRequest && <DropdownMenuSeparator />}
                {onDeleteRequest && (
                  <DropdownMenuItem
                    data-component="contracts-detail-more-delete"
                    variant="destructive"
                    onSelect={() => onDeleteRequest(doc.id)}
                  >
                    삭제
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      }
    >
      <div data-component="contracts-detail" className="grid grid-cols-2 gap-5">
        <InfoCard title="고객 정보" className="col-start-1 row-start-1 row-end-3">
          <InfoRow
            label="고객명"
            value={
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-v3-text-muted" />
                {customerName}
              </span>
            }
          />
          {contactInfo.phone && (
            <InfoRow label="연락처" value={contactInfo.phone} />
          )}
          {contactInfo.email && (
            <InfoRow
              label="이메일"
              value={
                <span className="flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-v3-text-muted" />
                  {contactInfo.email}
                </span>
              }
            />
          )}
        </InfoCard>

        <InfoCard title="계약 정보" className="col-start-2 row-start-1 row-end-5">
          <InfoRow label="문서명" value={doc.document_name} />
          <InfoRow label="템플릿" value={doc.template?.name ?? "–"} />
          <InfoRow label="문서번호" value={doc.document_number ?? "–"} />
          <InfoRow label="작성일" value={formatDate(doc.created_date)} />
          <InfoRow label="최종수정" value={formatDate(doc.updated_date)} />
        </InfoCard>

        <InfoCard title="활동 기록" className="col-start-1 row-start-3 row-end-5">
          <ActivityTimeline items={activityItems} maxHeight="300px" />
        </InfoCard>
      </div>

      <Dialog open={isReRequestDialogOpen} onOpenChange={handleReRequestDialogChange}>
        <DialogContent className="sm:max-w-[400px] h-auto gap-0 rounded-[24px] p-0" showCloseButton={false}>
          <DialogHeader className="px-6 pt-6 pb-3 text-left">
            <DialogTitle className="text-[1rem] font-semibold text-v3-dark">재요청</DialogTitle>
            <DialogDescription className="pt-2 text-[0.9rem] leading-6 text-v3-text-muted">
              {customerName} 님에게 전자문서 작성을 재요청 할까요?
            </DialogDescription>
          </DialogHeader>
          <div data-component="contracts-rerequest-phone-field" className="px-6 pb-2">
            <Label
              htmlFor={`contract-rerequest-phone-${doc.id}`}
              className="mb-2 block text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-v3-text-muted"
            >
              전송 전화번호
            </Label>
            <Input
              id={`contract-rerequest-phone-${doc.id}`}
              type="tel"
              inputMode="numeric"
              variant="v3"
              placeholder="010-1234-5678"
              value={formatPhoneNumber(recipientPhoneDigits)}
              onChange={(event) =>
                setRecipientPhone(normalizePhoneNumber(event.target.value).slice(0, 11))
              }
              maxLength={13}
              className={cn(
                "h-12 rounded-[16px] border-[1.5px] border-v3-border bg-white px-4 text-[0.85rem] text-v3-dark shadow-none transition-all focus-visible:border-v3-primary focus-visible:shadow-[0_0_0_3px_hsla(214,100%,34%,0.08)]",
                hasEditedRecipientPhone &&
                  !isRecipientPhoneValid &&
                  "border-v3-burgundy focus-visible:border-v3-burgundy focus-visible:shadow-[0_0_0_3px_hsla(348,83%,47%,0.08)]"
              )}
            />
            {hasEditedRecipientPhone && !isRecipientPhoneValid && (
              <p className="mt-2 text-[0.75rem] font-medium text-v3-burgundy">
                전송할 전화번호를 올바르게 입력해 주세요.
              </p>
            )}
          </div>
          <DialogFooter className="px-6 pb-6 pt-2 sm:justify-end">
            <Button
              variant="v3-outline"
              size="sm"
              onClick={() => handleReRequestDialogChange(false)}
              disabled={reRequestMutation.isPending}
              className="min-w-[88px]"
            >
              취소
            </Button>
            <Button
              variant="v3"
              size="sm"
              onClick={() => reRequestMutation.mutate()}
              disabled={reRequestMutation.isPending || !isRecipientPhoneValid}
              className="min-w-[88px]"
            >
              재요청
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DetailPanel>
  );
}
