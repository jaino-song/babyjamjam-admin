"use client";

import { redirect, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchDashboardClientPage,
  useDashboardOverview,
} from "@/hooks/useDashboardStats";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessageHistory } from "@/features/message-triggers/hooks/use-message-triggers";
import { isSmsHistoryRecord } from "@/features/message-triggers/channel";
import type { MessageLogRecord } from "@/features/message-triggers/types";
import { Client } from "@/lib/client/types";
import {
  getClientBadgeAvatarClassName,
  getClientBadges,
  getPrimaryClientBadge,
} from "@/lib/client/badges";
import { getActionRequiredStatus } from "@/lib/client/action-required";
import { matchesMessageHistoryClient } from "@/lib/message-history/client-match";
import {
  getMessageHistoryTimestamp,
  MESSAGE_HISTORY_STATUS_META,
  normalizeMessageHistoryRecord,
} from "@/components/app/messages/MessageHistoryDetailPanel";
import { useInitialUser } from "@/providers/UserProvider";
import { cn } from "@/lib/utils";
import {
  StatsBar,
  SplitLayout,
  DetailEmptyState,
  DetailPanel,
  DetailTabs,
  DetailTabPanels,
  InfoCard,
  InfoRow,
  StatusBadge,
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  RecentActivitiesPanel,
  type ActionRequiredItem,
} from "@/components/app/v3";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import {
  Users,
  Calendar,
  Send,
  MoreVertical,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";

import { Block } from "@/components/app/v3/Block";
import { mapStatusToLabel } from "@/lib/eformsign/status-codes";
import { eformsignApi, type LocalEformsignDocRecord } from "@/services/api";

const DASHBOARD_STAT_KEYS = [
  { icon: Users, valueKey: "activeClients" as const, label: "서비스 진행 중", colorIndex: 0, counter: "명" },
  { icon: Calendar, valueKey: "upcomingSoon" as const, label: "곧 시작 예정", colorIndex: 1, counter: "건" },
  { icon: Send, valueKey: "contractsRequired" as const, label: "계약서 필요", colorIndex: 3, counter: "건" },
];

const DASHBOARD_MESSAGE_HISTORY_LIMIT = 500;
const DASHBOARD_MESSAGE_HISTORY_STATUS_LABELS = {
  sent: "성공",
  failed: "실패",
  pending: "대기",
} as const;

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("ko-KR");
};

const formatPrice = (price: string | null): string => {
  if (!price) return "-";
  const cleaned = price.replace(/,/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num)) return "-";
  return `${num.toLocaleString("ko-KR")}원`;
};

const getDocumentStatusLabel = (status: Client["documentStatus"], locale: ReturnType<typeof useLocale>) => {
  if (status === null) return t(locale, "clients.form.doc-not-sent");

  const labelMap: Record<Exclude<Client["documentStatus"], null>, string> = {
    completed: t(locale, "clients.form.doc-completed"),
    opened: t(locale, "clients.form.doc-opened"),
    created: t(locale, "clients.form.doc-created"),
    requested: t(locale, "clients.form.doc-requested"),
    rejected: t(locale, "clients.form.doc-rejected"),
    revoked: t(locale, "clients.form.doc-revoked"),
    deleted: t(locale, "clients.form.doc-deleted"),
  };

  return labelMap[status];
};

const isContractDocumentRecord = (doc: LocalEformsignDocRecord): boolean =>
  doc.documentKind !== "service_feedback_snapshot";

const getDocumentTime = (dateStr: string): number => {
  const time = new Date(dateStr).getTime();
  return Number.isNaN(time) ? 0 : time;
};

function isToday(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return target.getTime() === today.getTime();
}

function getDashboardMessageHistoryTime(record: MessageLogRecord) {
  const timestamp = getMessageHistoryTimestamp(record);
  const time = new Date(timestamp).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function DashboardSmsHistoryList({
  records,
  isError,
  isLoading,
  clientName,
}: {
  records: MessageLogRecord[];
  isError: boolean;
  isLoading: boolean;
  clientName: string;
}) {
  if (isLoading) {
    return (
      <div data-component="dashboard-detail-sms-skeleton-list" className="w-full space-y-2">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            data-component="dashboard-detail-sms-skeleton-item"
            className="flex h-[calc(94px*var(--v3-ui-scale,1))] items-center gap-[calc(12px*var(--v3-ui-scale,1))] overflow-hidden rounded-[18px] border-2 border-transparent bg-white p-[calc(16px*var(--v3-ui-scale,1))]"
          >
            <Skeleton className="h-[calc(44px*var(--v3-ui-scale,1))] w-[calc(44px*var(--v3-ui-scale,1))] shrink-0 rounded-[14px] bg-v3-dim-white" />
            <div data-component="dashboard-detail-sms-skeleton-copy" className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-[calc(16px*var(--v3-ui-scale,1))] w-[calc(96px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
              <Skeleton className="h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(160px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
            </div>
            <div data-component="dashboard-detail-sms-skeleton-meta" className="flex shrink-0 flex-col items-end gap-2">
              <Skeleton className="h-[calc(24px*var(--v3-ui-scale,1))] w-[calc(56px*var(--v3-ui-scale,1))] rounded-full bg-v3-dim-white" />
              <Skeleton className="h-[calc(10px*var(--v3-ui-scale,1))] w-[calc(40px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div data-component="dashboard-detail-sms-error" className="w-full py-12 text-center text-[calc(13px*var(--v3-ui-scale,1))] text-v3-text-muted">
        메시지 발송 내역을 불러오지 못했습니다
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <DetailEmptyState
        name="dashboard-detail-sms-empty"
        message="메시지 발송 내역이 없습니다"
      />
    );
  }

  return (
    <div data-component="dashboard-detail-sms-list">
      <AnimatedSlotList<MessageLogRecord>
        items={records}
        isLoading={false}
        itemVariant="card"
        itemDataComponent="dashboard-detail-sms-list-item"
        getItemKey={(record) => String(record.id)}
        render={({ item: record }) => {
          if (!record) return null;

          const normalizedRecord = normalizeMessageHistoryRecord(record, {
            recipientNameFallback: clientName,
            recipientListLabelFallback: clientName,
          });
          const statusMeta = MESSAGE_HISTORY_STATUS_META[normalizedRecord.status] ?? MESSAGE_HISTORY_STATUS_META.failed;
          const statusBorderClassName =
            normalizedRecord.status === "sent"
              ? "border-[hsl(137,34%,84%)]"
              : normalizedRecord.status === "pending"
                ? "border-amber-100"
                : "border-red-100";
          const ItemIcon = normalizedRecord.icon;

          return (
            <AnimatedSlotListItemContent
              dataComponent="dashboard-detail-sms-list-item"
              icon={ItemIcon}
              iconContainerClassName="text-v3-primary"
              title={normalizedRecord.title}
              subtitle={normalizedRecord.messagePreview}
              status={
                <div
                  data-component="dashboard-detail-sms-list-item-meta"
                  className="flex shrink-0 flex-col items-end justify-end gap-1 text-right"
                >
                  <span
                    data-component="dashboard-detail-sms-list-item-status"
                    className={cn(
                      "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[50px] border px-[calc(12px*var(--v3-ui-scale,1))] py-[calc(4px*var(--v3-ui-scale,1))] text-[calc(10.4px*var(--v3-ui-scale,1))] font-semibold whitespace-nowrap transition-colors",
                      statusMeta.tone,
                      statusBorderClassName
                    )}
                  >
                    {DASHBOARD_MESSAGE_HISTORY_STATUS_LABELS[normalizedRecord.status]}
                  </span>
                </div>
              }
            />
          );
        }}
      />
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
    refetch: refetchOverview,
  } = useDashboardOverview(50);
  const {
    data: messageHistoryRecords = [],
    isLoading: isMessageHistoryLoading,
    isError: isMessageHistoryError,
  } = useMessageHistory(DASHBOARD_MESSAGE_HISTORY_LIMIT);
  const user = useInitialUser();
  const locale = useLocale();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState("basic");
  const [extraClientPages, setExtraClientPages] = useState<Client[][]>([]);
  const [isFetchingNextClients, setIsFetchingNextClients] = useState(false);
  const dashboardClientIdParam = searchParams.get("clientId");

  useEffect(() => {
    if (activeDetailTab === "alimtalk") {
      setActiveDetailTab("sms");
    }
  }, [activeDetailTab]);

  const dashboardClientId = useMemo(() => {
    if (!dashboardClientIdParam) {
      return null;
    }

    const numericId = Number(dashboardClientIdParam);
    return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
  }, [dashboardClientIdParam]);

  const initialClientsPage = overview?.clients;

  const clients = useMemo(() => {
    const initialClients = initialClientsPage?.data ?? [];
    return [...initialClients, ...extraClientPages.flat()];
  }, [extraClientPages, initialClientsPage?.data]);

  const hasMoreClients = Boolean(
    initialClientsPage && 1 + extraClientPages.length < initialClientsPage.totalPages
  );

  const updateDashboardClientQuery = useCallback((clientId: number | null) => {
    const currentClientId = searchParams.get("clientId");
    if (
      (clientId === null && currentClientId === null) ||
      (clientId !== null && currentClientId === String(clientId))
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    if (clientId === null) {
      params.delete("clientId");
    } else {
      params.set("clientId", String(clientId));
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `/dashboard?${nextQuery}` : "/dashboard", { scroll: false });
  }, [router, searchParams]);

  const fetchNextClients = useCallback(async () => {
    if (!initialClientsPage || isFetchingNextClients || !hasMoreClients) return;

    setIsFetchingNextClients(true);
    try {
      const nextPage = 2 + extraClientPages.length;
      const page = await fetchDashboardClientPage(nextPage, initialClientsPage.limit);
      setExtraClientPages((prev) => [...prev, page.data]);
    } finally {
      setIsFetchingNextClients(false);
    }
  }, [extraClientPages.length, hasMoreClients, initialClientsPage, isFetchingNextClients]);

  const refetchClients = useCallback(async () => {
    setExtraClientPages([]);
    await refetchOverview();
  }, [refetchOverview]);

  const handleSelectClient = useCallback((client: Client) => {
    setSelectedClient(client);
    updateDashboardClientQuery(client.id);
  }, [updateDashboardClientQuery]);

  const handleClearSelectedClient = useCallback(() => {
    setSelectedClient(null);
    updateDashboardClientQuery(null);
  }, [updateDashboardClientQuery]);

  useEffect(() => {
    if (!dashboardClientIdParam) {
      return;
    }

    if (dashboardClientId === null) {
      updateDashboardClientQuery(null);
      return;
    }

    const matchingClient = clients.find((client) => client.id === dashboardClientId);
    if (matchingClient) {
      setSelectedClient((current) => (
        current?.id === matchingClient.id ? current : matchingClient
      ));
      return;
    }

    if (!overviewLoading && hasMoreClients && !isFetchingNextClients) {
      void fetchNextClients();
      return;
    }

    if (!overviewLoading && !overviewError && !hasMoreClients && !isFetchingNextClients) {
      updateDashboardClientQuery(null);
    }
  }, [
    clients,
    dashboardClientId,
    dashboardClientIdParam,
    fetchNextClients,
    hasMoreClients,
    isFetchingNextClients,
    overviewError,
    overviewLoading,
    updateDashboardClientQuery,
  ]);

  const actionRequiredClients = useMemo(() => {
    return clients
      .map((client) => {
        const status = getActionRequiredStatus(client);
        if (!status) {
          return null;
        }

        return {
          client,
          reason: status.reason,
          priority: status.priority,
        } satisfies ActionRequiredItem;
      })
      .filter((item): item is ActionRequiredItem => item !== null)
      .sort((a, b) => a.priority - b.priority);
  }, [clients]);

  const upcomingClients = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);
    weekFromNow.setHours(23, 59, 59, 999);

    return clients
      .filter((c) => {
        if (!c.startDate) return false;
        const start = new Date(c.startDate);
        start.setHours(0, 0, 0, 0);
        return start >= today && start <= weekFromNow;
      })
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
  }, [clients]);

  const visibleUpcomingClients = useMemo(() => {
    return upcomingClients.filter((client) => !client.startDate || !isToday(client.startDate));
  }, [upcomingClients]);

  const dashboardStats = useMemo(() => {
    return {
      activeClients: clients.filter((client) => client.serviceStatus === "active").length,
      upcomingSoon: visibleUpcomingClients.length,
      contractsRequired: actionRequiredClients.filter((item) => (
        item.reason === "이용자 완료 필요" || item.reason === "발송 필요"
      )).length,
    };
  }, [actionRequiredClients, clients, visibleUpcomingClients]);

  const selectedClientData = useMemo(() => {
    if (!selectedClient) return null;
    return clients.find((client) => client.id === selectedClient.id) ?? selectedClient;
  }, [clients, selectedClient]);
  const selectedClientId = selectedClientData?.id ?? null;

  const {
    data: selectedClientDocs = [],
  } = useQuery({
    queryKey: ["eformsign-docs", "client", selectedClientId],
    queryFn: () => {
      if (selectedClientId === null) return Promise.resolve([]);
      return eformsignApi.getDocumentsByClientId(selectedClientId);
    },
    enabled: activeDetailTab === "contracts" && selectedClientId !== null,
    staleTime: 1000 * 60,
  });

  const selectedClientBadges = useMemo(() => {
    return getClientBadges(selectedClientData);
  }, [selectedClientData]);

  const selectedClientAvatarClass = useMemo(() => {
    return getClientBadgeAvatarClassName(getPrimaryClientBadge(selectedClientBadges));
  }, [selectedClientBadges]);

  const selectedClientSmsHistory = useMemo(() => {
    if (!selectedClientData) return [];

    return messageHistoryRecords
      .filter((record) => (
        isSmsHistoryRecord(record) &&
        matchesMessageHistoryClient(record, selectedClientData)
      ))
      .sort((left, right) => getDashboardMessageHistoryTime(right) - getDashboardMessageHistoryTime(left));
  }, [messageHistoryRecords, selectedClientData]);

  const selectedClientContractInfo = useMemo(() => {
    if (!selectedClientData) {
      return null;
    }

    const isDummyClient = selectedClientData.name.includes("[더미]");
    const newestContractDoc = selectedClientDocs
      .filter(isContractDocumentRecord)
      .sort((left, right) => getDocumentTime(right.createdDate) - getDocumentTime(left.createdDate))[0] ?? null;

    if (newestContractDoc) {
      return {
        contractName: "산모신생아 서비스 계약서",
        documentId: newestContractDoc.documentId,
        documentStatus: mapStatusToLabel(newestContractDoc.statusType),
        sentDate: formatDate(newestContractDoc.createdDate),
        contractPeriod: `${formatDate(selectedClientData.startDate)} ~ ${formatDate(selectedClientData.endDate)}`,
        contractAmount: formatPrice(selectedClientData.fullPrice),
      };
    }

    if (!isDummyClient) {
      return null;
    }

    const baseDate = selectedClientData.startDate ? new Date(selectedClientData.startDate) : new Date();
    const sentDate = new Date(baseDate);
    sentDate.setDate(baseDate.getDate() - 3);

    return {
      contractName: isDummyClient ? "더미 산모신생아 서비스 계약서" : "산모신생아 서비스 계약서",
      documentId: selectedClientData.eDocId ?? `dummy-edoc-${selectedClientData.id}`,
      documentStatus: getDocumentStatusLabel(selectedClientData.documentStatus, locale),
      sentDate: formatDate(sentDate.toISOString()),
      contractPeriod: `${formatDate(selectedClientData.startDate)} ~ ${formatDate(selectedClientData.endDate)}`,
      contractAmount: formatPrice(selectedClientData.fullPrice),
    };
  }, [selectedClientData, selectedClientDocs, locale]);

  if (!user) {
    redirect("/logout");
  }

  return (
    <section
      data-component="dashboard"
      className="flex flex-col gap-4 h-[calc(100dvh-11rem)] md:h-[calc(100dvh-4rem)]"
    >
      <h1 className="sr-only">대시보드</h1>
      <Block name="dashboard-stats" className="shrink-0">
        <StatsBar
          name="dashboard"
          isLoading={overviewLoading}
          density="responsive-square"
          items={DASHBOARD_STAT_KEYS.map((s) => ({
            icon: s.icon,
            value: dashboardStats[s.valueKey],
            label: s.label,
            counter: s.counter,
            colorIndex: s.colorIndex,
          }))}
        />
      </Block>

      <Block
        name="dashboard-split"
        className="flex-1 min-h-0"
      >
        <SplitLayout
          hasSelection={!!selectedClientData}
          onBack={handleClearSelectedClient}
        >
          <Block name="dashboard-activities-panel" className="h-full min-h-0">
            <RecentActivitiesPanel
              actionRequiredItems={actionRequiredClients}
              upcomingItems={visibleUpcomingClients}
              isLoading={overviewLoading}
              isError={overviewError}
              onRetry={() => refetchClients()}
              selectedId={selectedClientData?.id}
              onSelect={handleSelectClient}
              hasMore={hasMoreClients}
              onLoadMore={() => void fetchNextClients()}
              isFetchingMore={isFetchingNextClients}
            />
          </Block>

          {selectedClientData ? (
            <DetailPanel
              avatar={
                <div
                  data-component="dashboard-detail-avatar"
                  className={cn(
                    "w-16 h-16 rounded-[20px] flex items-center justify-center shadow-lg shrink-0",
                    selectedClientAvatarClass
                  )}
                >
                  <Users className="w-7 h-7 shrink-0 transition-colors text-current" aria-hidden="true" />
                </div>
              }
              title={selectedClientData.name}
              badges={
                <>
                  {selectedClientBadges
                    .filter((badge) => badge.key !== "breast_pump")
                    .map((badge) => (
                      <StatusBadge
                        key={badge.key}
                        status={badge.status}
                        label={badge.label}
                      />
                    ))}
                </>
              }
              badgesRight={
                <>
                  {selectedClientBadges
                    .filter((badge) => badge.key === "breast_pump")
                    .map((badge) => (
                      <StatusBadge
                        key={badge.key}
                        status={badge.status}
                        label={badge.label}
                      />
                    ))}
                </>
              }
              subtitle={
                <>
                  {selectedClientData.type || "일반"} ·{" "}
                  {selectedClientData.duration ? `${selectedClientData.duration}일` : "-"}
                </>
              }
              trailing={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="고객 상세 메뉴"
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v3-primary focus-visible:ring-offset-2"
                    >
                      <MoreVertical className="w-5 h-5 text-v3-text-muted" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[140px]">
                    <DropdownMenuItem asChild className="gap-2">
                      <Link href={`/clients?id=${selectedClientData.id}`}>
                        <ExternalLink className="w-4 h-4" />
                        고객 상세 보기
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
              tabs={
                <DetailTabs
                  tabs={[
                    { key: "basic", label: "기본 정보" },
                    { key: "contracts", label: "계약서 정보" },
                    { key: "sms", label: "메시지 발송 현황" },
                  ]}
                  activeTab={activeDetailTab}
                  onTabChange={setActiveDetailTab}
                  ariaLabel="고객 상세 정보"
                  idPrefix="dashboard-client-detail"
                />
              }
            >
              <DetailTabPanels
                activeTab={activeDetailTab}
                className="flex min-h-0 flex-1 flex-col"
                dataComponent="dashboard-detail-content"
                panelDataComponent="dashboard-detail-content-panel"
                idPrefix="dashboard-client-detail"
                trackClassName="min-h-0 flex-1"
                panels={[
                  {
                    key: "basic",
                    children: (
                      <div data-component="dashboard-detail-basic-grid" className="grid grid-cols-2 gap-4">
                        <InfoCard title={t(locale, "clients.form.customer-info") || "고객 정보"} className="col-start-1 row-start-1 row-end-3">
                          <InfoRow label={t(locale, "clients.form.name")} value={selectedClientData.name} />
                          <InfoRow label={t(locale, "clients.form.birthday")} value={selectedClientData.birthday || "-"} />
                          <InfoRow label={t(locale, "clients.form.due-date")} value={formatDate(selectedClientData.dueDate)} />
                          <InfoRow label={t(locale, "clients.form.phone")} value={selectedClientData.phone || "-"} />
                          <InfoRow label={t(locale, "clients.form.address")} value={selectedClientData.address || "-"} />
                        </InfoCard>

                        <InfoCard title={t(locale, "clients.form.assigned-employee") || "담당 관리사"} className="col-start-1 row-start-3 row-end-5">
                          <InfoRow label={t(locale, "clients.form.primary-employee")} value={selectedClientData.primaryEmployee?.name ?? "-"} />
                          <InfoRow label={t(locale, "clients.form.secondary-employee")} value={selectedClientData.secondaryEmployee?.name ?? "-"} />
                        </InfoCard>

                        <InfoCard title={t(locale, "clients.form.service-info") || "서비스 정보"} className="col-start-2 row-start-1 row-end-5">
                          <InfoRow label={t(locale, "clients.form.voucher-type")} value={selectedClientData.type || "-"} />
                          <InfoRow label={t(locale, "clients.form.duration")} value={selectedClientData.duration ? `${selectedClientData.duration}일` : "-"} />
                          <InfoRow label={t(locale, "clients.form.start-date")} value={formatDate(selectedClientData.startDate)} />
                          <InfoRow label={t(locale, "clients.form.end-date")} value={formatDate(selectedClientData.endDate)} />
                          <InfoRow label={t(locale, "clients.form.full-price")} value={formatPrice(selectedClientData.fullPrice)} />
                          <InfoRow label={t(locale, "clients.form.grant")} value={formatPrice(selectedClientData.grant)} />
                          <InfoRow label={t(locale, "clients.form.actual-price")} value={formatPrice(selectedClientData.actualPrice)} />
                        </InfoCard>
                      </div>
                    ),
                  },
                  {
                    key: "contracts",
                    children: selectedClientContractInfo ? (
                      <div data-component="dashboard-detail-contracts-grid" className="grid grid-cols-2 gap-4">
                        <InfoCard title="계약서 정보" className="col-span-2">
                          <InfoRow label="계약서명" value={selectedClientContractInfo.contractName} />
                          <InfoRow label="계약서 ID" value={selectedClientContractInfo.documentId} />
                          <InfoRow label="문서 상태" value={selectedClientContractInfo.documentStatus} />
                          <InfoRow label="발송일" value={selectedClientContractInfo.sentDate} />
                          <InfoRow label="계약 기간" value={selectedClientContractInfo.contractPeriod} />
                          <InfoRow label="계약 금액" value={selectedClientContractInfo.contractAmount} />
                        </InfoCard>
                      </div>
                    ) : (
                      <DetailEmptyState
                        name="dashboard-detail-contracts-empty"
                        message="계약서 정보가 없습니다"
                      />
                    ),
                  },
                  {
                    key: "sms",
                    className: "flex min-h-0",
                    children: (
                      <DashboardSmsHistoryList
                        records={selectedClientSmsHistory}
                        isLoading={isMessageHistoryLoading}
                        isError={isMessageHistoryError}
                        clientName={selectedClientData.name}
                      />
                    ),
                  },
                ]}
              />
            </DetailPanel>
          ) : (
            <DetailPanel
              emptyState={
                <DetailEmptyState
                  name="dashboard-detail-empty"
                  message="항목을 선택하면 상세 정보가 표시됩니다"
                />
              }
            >
              {null}
            </DetailPanel>
          )}
        </SplitLayout>
      </Block>
    </section>
  );
}
