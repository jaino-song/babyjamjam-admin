"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Send,
  Calendar,
  User,
  Mail,
  MoreVertical,
  Eye,
  MapPin,
  Loader2,
} from "lucide-react";
import {
  useDeleteEformsignDocument,
  useEformsignDocumentsByType,
} from "@/hooks/useEformsignDocuments";
import { useEformsignAuth } from "@/hooks/useEformsignAuth";
import { useInfiniteContracts } from "@/hooks/useInfiniteContracts";
import { useEformsignWebhookUpdates } from "@/hooks/useEformsignWebhookUpdates";
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
  DetailTabs,
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  extractDocumentAddress,
  extractDocumentContactInfo,
  extractDocumentFieldValue,
  extractDocumentFieldValues,
  extractOpenEvents,
  extractReRequestEvents,
} from "@/lib/eformsign/document-details";
import { useAllVoucherPriceInfos } from "@/hooks/useVoucherData";
import { inferVoucherDurationFromAmounts } from "@/lib/voucher/duration";
import { clientsApi } from "@/features/clients/api/clients.api";
import type { Client, PaginatedResponse } from "@/lib/client/types";
import { ContractsListItem } from "@/components/app/contracts/ContractsListItem";
import { ContractDocumentPreviewModal } from "@/components/app/contracts/ContractDocumentPreviewModal";

const EXCLUDED_CUSTOMER_NAMES = ["송진호", "인천 아이미래로"];

const TAB_ITEMS = [
  { label: "전체", value: "all" },
  { label: "대기", value: "in-progress" },
  { label: "완료", value: "completed" },
  { label: "거부", value: "rejected" },
];

const DETAIL_TABS = [
  { key: "document", label: "문서정보" },
  { key: "provider", label: "제공인력 정보" },
  { key: "service", label: "서비스 정보" },
] as const;

type DetailTabKey = (typeof DETAIL_TABS)[number]["key"];

type InfoCardRow = {
  label: string;
  value: React.ReactNode;
};

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
    hour12: false,
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

function getSignatureProgress(
  category: "completed" | "rejected" | "in-progress",
  hasOpenedDocument: boolean
) {
  const steps = [
    { label: "문서 생성", done: true },
    { label: "발송 완료", done: true },
    { label: "문서 열람", done: category === "completed" || hasOpenedDocument },
    { label: "계약 완료", done: category === "completed" },
  ];
  return steps;
}

function normalizePhoneNumber(
  value:
    | string
    | null
    | undefined
    | {
        country_code?: string;
        phone_number?: string;
      }
): string {
  const rawValue =
    typeof value === "string"
      ? value
      : `${value?.country_code ?? ""}${value?.phone_number ?? ""}`;
  const digits = rawValue.replace(/\D/g, "");

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

function formatOptionalPhoneNumber(value: string | null | undefined): string {
  const digits = normalizePhoneNumber(value);
  return digits ? formatPhoneNumber(digits) : "–";
}

function formatCurrencyValue(value: string | null | undefined): string {
  if (!value) {
    return "–";
  }

  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return value;
  }

  return `${Number(digits).toLocaleString("ko-KR")}원`;
}

function formatFieldDate(year?: string | null, month?: string | null, day?: string | null): string | null {
  if (!year || !month || !day) {
    return null;
  }

  const normalizedYear = year.length === 2 ? `20${year}` : year;
  return `${normalizedYear}. ${month.padStart(2, "0")}. ${day.padStart(2, "0")}.`;
}

function formatSingleFieldDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^(\d{2,4})\s*(?:년|[./-])\s*(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*(?:일)?\.?$/
  );
  if (!match) {
    return trimmed;
  }

  const [, year, month, day] = match;
  return formatFieldDate(year, month, day);
}

function extractFieldDate(
  document: Pick<EformsignDocument, "fields" | "detail_template_info"> | null | undefined,
  aliases: {
    year: string[];
    month: string[];
    day: string[];
    full?: string[];
  }
): string | null {
  const splitDate = formatFieldDate(
    extractDocumentFieldValue(document, aliases.year),
    extractDocumentFieldValue(document, aliases.month),
    extractDocumentFieldValue(document, aliases.day)
  );
  if (splitDate) {
    return splitDate;
  }

  return formatSingleFieldDate(
    aliases.full ? extractDocumentFieldValue(document, aliases.full) : null
  );
}

function pickServiceDaysValue(values: string[]): string | null {
  const matchedValue = values.find((value) => /^\d+일?$/.test(value.trim()));
  if (!matchedValue) {
    return null;
  }

  return matchedValue.endsWith("일") ? matchedValue : `${matchedValue}일`;
}

function pickContractDurationValue(values: string[]): string | null {
  return (
    values.find((value) => value.includes("~")) ??
    values.find((value) => value.includes("-")) ??
    null
  );
}

function normalizeDocumentYear(value: string | null | undefined, fallbackTimestamp: number): number {
  const digits = value?.replace(/[^\d]/g, "") ?? "";
  if (digits) {
    const normalized = digits.length === 2 ? `20${digits}` : digits.slice(0, 4);
    const year = Number(normalized);
    if (Number.isInteger(year) && year >= 2000 && year <= 2999) {
      return year;
    }
  }

  return new Date(fallbackTimestamp).getFullYear();
}

function InfoRowsCard({
  title,
  rows,
  loading = false,
  className,
}: {
  title: string;
  rows: InfoCardRow[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <InfoCard title={title} className={className}>
      {rows.map((row, index) => (
        <InfoRow
          key={row.label}
          label={row.label}
          value={loading ? (
            <div data-component="info-row-skeleton" className="flex w-full justify-end">
              <Skeleton
                className={cn(
                  "bg-v3-border/70",
                  row.label === "주소" ? "h-10 w-[78%] rounded-[12px]" : "h-4 rounded-full",
                  row.label !== "주소" && ([
                    "w-24",
                    "w-20",
                    "w-28",
                    "w-32",
                    "w-36",
                    "w-24",
                  ][index % 6]),
                )}
              />
            </div>
          ) : row.value}
        />
      ))}
    </InfoCard>
  );
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

  const { isAuthenticated, isLoading: isLoadingAuth, error: authError } = useEformsignAuth({
    syncOnWindowFocus: false,
  });
  const { pendingDocumentIds } = useEformsignWebhookUpdates(isAuthenticated);
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

  const isBootstrappingAuth = isLoadingAuth && !isAuthenticated;
  // Initial loading: first auth bootstrap or first "all" data fetch
  const isInitialLoading = isBootstrappingAuth || isLoadingAll;
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
    return (
      documents.find((d) => d.id === selectedDocId) ??
      allData?.documents?.find((d) => d.id === selectedDocId) ??
      null
    );
  }, [selectedDocId, documents, allData?.documents]);

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
                getItemKey={(doc) => doc.id}
                slotClassName={({ item, isLoading }) => {
                  const isRefreshing = Boolean(item && pendingDocumentIds.has(item.id));
                  const isActive = !isLoading && item && selectedDocument?.id === item.id;
                  return cn(
                    "flex items-center gap-3 p-4 rounded-[18px] transition-all duration-200 bg-white border-2 border-transparent",
                    !isLoading && !isRefreshing && "cursor-pointer",
                    isActive
                      ? "bg-v3-primary-light border-2 border-v3-primary"
                      : !isLoading && !isRefreshing && "hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                  );
                }}
                onSlotClick={(doc) => setSelectedDocId(doc.id)}
                // Load more props
                hasMore={hasNextPage}
                onLoadMore={() => fetchNextPage()}
                isFetchingMore={isFetchingNextPage}
                render={({ item: doc, isLoading }) => {
                  return (
                    <ContractsListItem
                      document={doc}
                      customerName={doc ? getCustomerName(doc) : null}
                      isLoading={isLoading}
                      isRefreshing={Boolean(doc && pendingDocumentIds.has(doc.id))}
                    />
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
              isRefreshing={pendingDocumentIds.has(selectedDocument.id)}
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
          <DialogFooter className="gap-2">
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
  isRefreshing = false,
  onDeleteRequest,
}: {
  document: EformsignDocument;
  isRefreshing?: boolean;
  onDeleteRequest?: (documentId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const customerName = getCustomerName(doc) ?? "–";
  const detailQuery = useQuery<EformsignDocument>({
    queryKey: ["eformsign-documents", "detail", doc.id],
    queryFn: async () => eformsignApi.getDocument(doc.id),
    placeholderData: doc,
    staleTime: 1000 * 60,
    refetchOnWindowFocus: false,
  });
  const detailedDocument = detailQuery.data ?? doc;
  const isBaseDetailLoading = detailQuery.isFetching || detailQuery.isPlaceholderData;
  const category = getStatusCategory(detailedDocument.current_status?.status_type);
  const statusType = mapCategoryToStatusType(category);
  const statusLabel = mapStatusToLabel(detailedDocument.current_status?.status_type);
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTabKey>("document");
  const [isReRequestDialogOpen, setIsReRequestDialogOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const canReRequest = canReRequestDocument(detailedDocument);
  const reRequestStepType = detailedDocument.current_status?.step_type ?? "";
  const reRequestStepSeq = detailedDocument.current_status?.step_index ?? "";
  const currentRecipient = detailedDocument.current_status?.step_recipients?.[0];
  const contactInfo = extractDocumentContactInfo(detailedDocument);
  const initialRecipientPhone = normalizePhoneNumber(currentRecipient?.sms);
  const [recipientPhone, setRecipientPhone] = useState(initialRecipientPhone);
  const recipientPhoneDigits = normalizePhoneNumber(recipientPhone);
  const hasEditedRecipientPhone = recipientPhoneDigits !== initialRecipientPhone;
  const isRecipientPhoneValid =
    !hasEditedRecipientPhone || (recipientPhoneDigits.length >= 10 && recipientPhoneDigits.length <= 11);
  const documentAddress = extractDocumentAddress(detailedDocument);
  const clientAddressQuery = useQuery<string | null>({
    queryKey: ["clients", "contract-address", doc.id, customerName],
    queryFn: async () => {
      const localDocRecord = await eformsignApi.getLocalDocumentRecord(doc.id).catch(() => null);
      const linkedClientId = localDocRecord?.clientId;

      if (linkedClientId) {
        const clientResponse = await clientsApi.getById(linkedClientId);
        return clientResponse.data.address ?? null;
      }

      const response = await clientsApi.list({
        page: 1,
        limit: 100,
        search: customerName,
      });
      const { data } = response.data as PaginatedResponse<Client>;
      const matchedClient =
        data.find((client) => client.eDocId === doc.id) ??
        data.find(
          (client) =>
            client.name === customerName &&
            normalizePhoneNumber(client.phone) === normalizePhoneNumber(contactInfo.phone)
        ) ??
        null;

      return matchedClient?.address ?? null;
    },
    enabled: !documentAddress && customerName !== "–",
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
  const customerAddress = documentAddress ?? clientAddressQuery.data ?? null;
  const isCustomerInfoLoading = isBaseDetailLoading || (!documentAddress && clientAddressQuery.isLoading);
  const customerBirthDate =
    extractDocumentFieldValue(detailedDocument, [
      "이용자 생년월일",
      "이용자생년월일",
      "고객 생년월일",
      "고객생년월일",
      "산모 생년월일",
      "산모생년월일",
    ]) ?? "–";
  const provider1Name =
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 1 성명",
      "제공인력1성명",
      "제공인력 성명",
      "제공인력성명",
    ]) ?? "–";
  const provider1Contact = formatOptionalPhoneNumber(
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 1 연락처",
      "제공인력1연락처",
      "제공인력 연락처",
      "제공인력연락처",
    ])
  );
  const provider2Name =
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 2 성명",
      "제공인력2성명",
      "추가 제공인력 성명",
      "추가제공인력성명",
    ]) ?? "–";
  const provider2Contact = formatOptionalPhoneNumber(
    extractDocumentFieldValue(detailedDocument, [
      "제공인력 2 연락처",
      "제공인력2연락처",
      "추가 제공인력 연락처",
      "추가제공인력연락처",
    ])
  );
  const servicePriceValue = extractDocumentFieldValue(detailedDocument, [
    "서비스 비용",
    "서비스비용",
    "서비스 가격",
    "서비스가격",
    "fullPrice",
  ]);
  const governmentGrantValue = extractDocumentFieldValue(detailedDocument, [
    "정부지원금",
    "grant",
  ]);
  const outOfPocketValue = extractDocumentFieldValue(detailedDocument, [
    "본인부담금",
    "actualPrice",
  ]);
  const servicePrice = formatCurrencyValue(servicePriceValue);
  const governmentGrant = formatCurrencyValue(governmentGrantValue);
  const outOfPocket = formatCurrencyValue(outOfPocketValue);
  const servicePeriodValues = extractDocumentFieldValues(detailedDocument, [
    "서비스 기간",
    "서비스기간",
    "서비스 일수",
    "서비스일수",
    "days",
  ]);
  const voucherPriceYear = normalizeDocumentYear(
    extractDocumentFieldValue(detailedDocument, [
      "계약 시작 년도",
      "계약시작년도",
      "startYear",
      "voucherYear",
      "receiptYear",
    ]),
    detailedDocument.created_date
  );
  const allVoucherPriceInfosQuery = useAllVoucherPriceInfos(voucherPriceYear);
  const inferredServiceDays = useMemo(() => {
    const duration = inferVoucherDurationFromAmounts(allVoucherPriceInfosQuery.data, {
      fullPrice: servicePriceValue,
      grant: governmentGrantValue,
      actualPrice: outOfPocketValue,
    });

    return duration ? `${duration}일` : null;
  }, [
    allVoucherPriceInfosQuery.data,
    governmentGrantValue,
    outOfPocketValue,
    servicePriceValue,
  ]);
  const serviceDays = pickServiceDaysValue(servicePeriodValues) ?? inferredServiceDays ?? "–";
  const isServiceInfoLoading = isBaseDetailLoading || allVoucherPriceInfosQuery.isLoading;
  const contractDuration =
    pickContractDurationValue(servicePeriodValues) ??
    "–";
  const contractStartDate =
    extractFieldDate(detailedDocument, {
      year: ["계약 시작 년도", "계약시작년도", "startYear"],
      month: ["계약 시작 월", "계약시작월", "startMonth"],
      day: ["계약 시작 일", "계약시작일", "startDay"],
      full: ["계약 시작일", "계약시작일", "서비스 시작일", "서비스시작일", "startDate"],
    }) ?? "–";
  const contractEndDate =
    extractFieldDate(detailedDocument, {
      year: ["계약 종료 년도", "계약종료년도", "endYear"],
      month: ["계약 종료 월", "계약종료월", "endMonth"],
      day: ["계약 종료 일", "계약종료일", "endDay"],
      full: ["계약 종료일", "계약종료일", "서비스 종료일", "서비스종료일", "endDate"],
    }) ?? "–";
  const paymentDate =
    extractFieldDate(detailedDocument, {
      year: ["본인부담금 수령 년도", "본인부담금수령년도", "결제 년도", "결제년도", "paymentYear"],
      month: ["본인부담금 수령 월", "본인부담금수령월", "결제 월", "결제월", "paymentMonth"],
      day: ["본인부담금 수령 일", "본인부담금수령일", "결제 일", "결제일", "paymentDay"],
      full: ["본인부담금 수령일", "본인부담금수령일", "결제일", "paymentDate"],
    }) ?? "–";
  const receiptDate =
    extractFieldDate(detailedDocument, {
      year: ["영수증 년도", "영수증년도", "영수증 발행 년도", "영수증발행년도", "receiptYear"],
      month: ["영수증 월", "영수증월", "영수증 발행 월", "영수증발행월", "receiptMonth"],
      day: ["영수증 일", "영수증일", "영수증 발행 일", "영수증발행일", "receiptDay"],
      full: ["영수증 발행일", "영수증발행일", "영수증 날짜", "영수증날짜", "receiptDate"],
    }) ??
    // Contract creation currently stamps receipt fields with the document generation date.
    formatDate(detailedDocument.created_date);
  const reRequestEvents = extractReRequestEvents(detailedDocument);
  const openEvents = extractOpenEvents(detailedDocument);
  const hasOpenedDocument = openEvents.length > 0;
  const steps = getSignatureProgress(category, hasOpenedDocument);
  const sentDate = formatDateTime(detailedDocument.created_date);
  const sentDateLabel = formatDate(detailedDocument.created_date);
  const lastModifiedDate = formatDateTime(detailedDocument.updated_date);
  const contractCompletedDate =
    category === "completed" ? formatDateTime(detailedDocument.updated_date) : null;
  const contractCompletedDateLabel =
    category === "completed" ? formatDate(detailedDocument.updated_date) : null;

  const expiredDate = detailedDocument.current_status?.expired_date;

  const handleReRequestDialogChange = (open: boolean) => {
    setIsReRequestDialogOpen(open);
    setRecipientPhone(initialRecipientPhone);
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
      queryClient.invalidateQueries({ queryKey: ["clients", "contract-address", doc.id] });
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
      time: formatDateTime(detailedDocument.created_date),
    },
    {
      icon: Send,
      iconVariant: "info",
      text: `${customerName}에게 발송되었습니다`,
      time: formatDateTime(detailedDocument.created_date),
    },
  ];

  const inFlightEvents = [
    ...reRequestEvents.map((event) => ({ ...event, type: "rerequest" as const })),
    ...openEvents.map((event) => ({ ...event, type: "open" as const })),
  ].sort((left, right) => left.timestamp - right.timestamp);

  for (const event of inFlightEvents) {
    if (event.type === "rerequest") {
      activityItems.push({
        icon: Send,
        iconVariant: "warning",
        text: `${customerName}에게 재요청을 보냈습니다`,
        time: formatDateTime(event.timestamp),
      });
      continue;
    }

    activityItems.push({
      icon: Eye,
      iconVariant: "info",
      text: `${customerName}님이 문서를 열람했습니다`,
      time: formatDateTime(event.timestamp),
    });
  }

  if (category === "completed") {
    activityItems.push({
      icon: CheckCircle2,
      iconVariant: "success",
      text: "서명이 완료되었습니다",
      time: formatDateTime(detailedDocument.updated_date),
    });
  } else if (category === "rejected") {
    activityItems.push({
      icon: AlertTriangle,
      iconVariant: "danger",
      text: "문서가 거부/만료되었습니다",
      time: formatDateTime(detailedDocument.updated_date),
    });
  } else {
    activityItems.push({
      icon: Eye,
      iconVariant: "warning",
      text: hasOpenedDocument ? "서명 대기중입니다" : "아직 문서 열람을 하지 않았습니다",
      time: "현재",
    });
  }

  const documentTabCards = [
    <InfoRowsCard
      key="document-profile"
      title="고객 정보"
      loading={isCustomerInfoLoading}
      className="self-start"
      rows={[
        {
          label: "고객명",
          value: (
            <span className="flex w-full items-center justify-end gap-1.5 text-right">
              <User className="w-3.5 h-3.5 text-v3-text-muted" />
              {customerName}
            </span>
          ),
        },
        { label: "생년월일", value: customerBirthDate },
        {
          label: "주소",
          value: customerAddress ? (
            <span className="flex w-full min-w-0 items-start justify-end gap-1.5 text-right leading-5">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-v3-text-muted" />
              <span className="break-keep whitespace-normal">{customerAddress}</span>
            </span>
          ) : (
            "–"
          ),
        },
        { label: "연락처", value: formatOptionalPhoneNumber(contactInfo.phone) },
        {
          label: "이메일",
          value: contactInfo.email ? (
            <span className="flex w-full items-center justify-end gap-1.5 text-right">
              <Mail className="w-3.5 h-3.5 text-v3-text-muted" />
              {contactInfo.email}
            </span>
          ) : (
            "–"
          ),
        },
      ]}
    />,
    <InfoRowsCard
      key="document-contract"
      title="전자문서 정보"
      loading={isBaseDetailLoading}
      rows={[
        { label: "문서명", value: detailedDocument.document_name },
        { label: "템플릿", value: detailedDocument.template?.name ?? "–" },
        { label: "문서번호", value: detailedDocument.document_number ?? "–" },
        { label: "작성일", value: sentDate },
        { label: "최종수정일", value: lastModifiedDate },
        { label: "발송일", value: sentDate },
        ...(contractCompletedDate
          ? [{ label: "서명 완료일", value: contractCompletedDate }]
          : []),
        {
          label: "문서 ID",
          value: (
            <span className="max-w-[14rem] break-all font-mono text-[0.75rem]">
              {detailedDocument.id}
            </span>
          ),
        },
      ]}
    />,
  ];

  const providerTabCards = [
    <InfoRowsCard
      key="provider-primary"
      title="제공인력 1"
      loading={isBaseDetailLoading}
      rows={[
        { label: "성명", value: provider1Name },
        { label: "연락처", value: provider1Contact },
      ]}
    />,
    <InfoRowsCard
      key="provider-secondary"
      title="제공인력 2"
      loading={isBaseDetailLoading}
      rows={[
        { label: "성명", value: provider2Name },
        { label: "연락처", value: provider2Contact },
      ]}
    />,
  ];

  const serviceTabCards = [
    <InfoRowsCard
      key="service-schedule"
      title="서비스 정보"
      loading={isServiceInfoLoading}
      rows={[
        { label: "계약 기간", value: contractDuration },
        { label: "서비스 일수", value: serviceDays },
        { label: "계약 시작일", value: contractStartDate },
        { label: "계약 종료일", value: contractEndDate },
        { label: "본인부담금 수령일", value: paymentDate },
        { label: "영수증 발행일", value: receiptDate },
      ]}
    />,
    <InfoRowsCard
      key="service-pricing"
      title="서비스 비용"
      loading={isServiceInfoLoading}
      rows={[
        { label: "서비스 비용", value: servicePrice },
        { label: "정부지원금", value: governmentGrant },
        { label: "본인부담금", value: outOfPocket },
        { label: "바우처 가격표 연도", value: `${voucherPriceYear}년` },
      ]}
    />,
  ];

  const activeTabCards =
    activeDetailTab === "document"
      ? documentTabCards
      : activeDetailTab === "provider"
        ? providerTabCards
        : serviceTabCards;

  return (
    <DetailPanel
      title={detailedDocument.document_name}
      badges={<StatusBadge status={statusType} label={statusLabel} />}
      subtitle={
        <span className="flex flex-wrap items-center gap-4 text-[0.75rem]">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" />
            발송일: {sentDateLabel}
          </span>
          {contractCompletedDate && (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              서명 완료일: {contractCompletedDateLabel}
            </span>
          )}
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
          {isRefreshing && (
            <div
              data-component="contracts-detail-sync-indicator"
              className="flex items-center gap-1 rounded-full bg-v3-dim-white px-3 py-1 text-[0.7rem] font-medium text-v3-text-muted"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              동기화 중
            </div>
          )}
          <Button
            variant="positive"
            size="sm"
            data-component="contracts-detail-preview-trigger"
            className="mt-0.5"
            onClick={() => setIsPreviewOpen(true)}
          >
            <Eye className="h-4 w-4" />
            문서 보기
          </Button>
          <button
            type="button"
            data-component="contracts-detail-activity-trigger"
            className="overflow-visible rounded-[18px] p-1 transition-colors duration-200 ease-out hover:bg-black/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary/20"
            onClick={() => setIsActivityOpen(true)}
            aria-label="활동 기록 보기"
            title="활동 기록 보기"
          >
            <Stepper steps={steps} />
          </button>
          {(canReRequest || onDeleteRequest) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  data-component="contracts-detail-more-trigger"
                  className="mt-0.5 h-9 w-9 rounded-full border-0 text-v3-text-muted hover:bg-v3-dim-white hover:text-v3-primary"
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
      tabs={
        <DetailTabs
          tabs={[...DETAIL_TABS]}
          activeTab={activeDetailTab}
          onTabChange={(key) => setActiveDetailTab(key as DetailTabKey)}
        />
      }
    >
      <div data-component="contracts-detail-content" className="space-y-5">
        <div data-component="contracts-detail-tab-panel" className="grid gap-5 lg:grid-cols-2">
          {activeTabCards}
        </div>
      </div>

      <Dialog open={isReRequestDialogOpen} onOpenChange={handleReRequestDialogChange}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>재요청</DialogTitle>
            <DialogDescription>
              {customerName} 님에게 전자문서 작성을 재요청 할까요?
            </DialogDescription>
          </DialogHeader>
          <div data-component="contracts-rerequest-phone-field" className="pb-2">
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
          <DialogFooter>
            <Button
              variant="neutral"
              onClick={() => handleReRequestDialogChange(false)}
              disabled={reRequestMutation.isPending}
            >
              취소
            </Button>
            <Button
              variant="positive"
              onClick={() => reRequestMutation.mutate()}
              disabled={reRequestMutation.isPending || !isRecipientPhoneValid}
            >
              재요청
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={isActivityOpen} onOpenChange={setIsActivityOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>활동 기록</DialogTitle>
          </DialogHeader>
          <div data-component="contracts-activity-modal-body">
            <div data-component="contracts-activity-modal-timeline">
              <ActivityTimeline items={activityItems} maxHeight="360px" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="positive" onClick={() => setIsActivityOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ContractDocumentPreviewModal
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        document={detailedDocument}
        customerName={customerName}
      />
    </DetailPanel>
  );
}
