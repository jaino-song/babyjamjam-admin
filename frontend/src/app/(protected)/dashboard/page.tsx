"use client";

import { redirect } from "next/navigation";
import { useMemo, useState } from "react";

import {
  fetchDashboardClientPage,
  useDashboardOverview,
} from "@/hooks/useDashboardStats";
import { Client } from "@/lib/client/types";
import { getActionRequiredStatus } from "@/lib/client/action-required";
import { useInitialUser } from "@/providers/UserProvider";
import { cn } from "@/lib/utils";
import {
  StatsBar,
  SplitLayout,
  DetailPanel,
  DetailTabs,
  DetailTabPanels,
  InfoCard,
  InfoRow,
  StatusBadge,
  RecentActivitiesPanel,
  type ActionRequiredItem,
  type StatusType,
} from "@/components/app/v3";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import {
  Users,
  Calendar,
  FileSignature,
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

const DASHBOARD_STAT_KEYS = [
  { icon: Users, valueKey: "activeClients" as const, label: "서비스 진행 중", colorIndex: 0, counter: "명" },
  { icon: Calendar, valueKey: "upcomingThisMonth" as const, label: "이번달 시작 예정", colorIndex: 1, counter: "건" },
  { icon: FileSignature, valueKey: "contractsPendingSignature" as const, label: "문서 서명 대기 중", colorIndex: 2, counter: "건" },
  { icon: Send, valueKey: "contractsNotSent" as const, label: "문서 발송 대기 중", colorIndex: 3, counter: "건" },
];

const getAvatarGradient = (name: string) => {
  const charCode = name.charCodeAt(0);
  const gradients = [
    "bg-gradient-to-br from-[hsl(214,100%,34%)] to-[hsl(214,100%,28%)]",
    "bg-gradient-to-br from-[hsl(137,34%,31%)] to-[hsl(137,34%,25%)]",
    "bg-gradient-to-br from-[hsl(355,36%,45%)] to-[hsl(355,36%,38%)]",
    "bg-gradient-to-br from-[hsl(34,100%,55%)] to-[hsl(34,100%,45%)]",
    "bg-gradient-to-br from-[hsl(175,60%,40%)] to-[hsl(175,60%,30%)]",
    "bg-gradient-to-br from-[hsl(270,60%,55%)] to-[hsl(270,60%,45%)]",
  ];
  return gradients[charCode % gradients.length];
};

const mapServiceStatusToV3 = (status: string | null): StatusType => {
  switch (status) {
    case "active":
      return "active";
    case "waiting":
      return "pending";
    case "replacement_requested":
      return "terminated";
    case "terminated":
      return "terminated";
    case "completed":
      return "completed";
    default:
      return "pending";
  }
};

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

const getStatusLabel = (status: string | null): string => {
  switch (status) {
    case "active":
      return "진행중";
    case "waiting":
      return "대기";
    case "replacement_requested":
      return "교체 요청";
    case "completed":
      return "완료";
    case "terminated":
      return "중단";
    default:
      return "-";
  }
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

export default function DashboardPage() {
  const {
    data: overview,
    isLoading: overviewLoading,
    isError: overviewError,
    refetch: refetchOverview,
  } = useDashboardOverview(50);
  const user = useInitialUser();
  const locale = useLocale();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState("basic");
  const [extraClientPages, setExtraClientPages] = useState<Client[][]>([]);
  const [isFetchingNextClients, setIsFetchingNextClients] = useState(false);

  const stats = overview?.stats;
  const initialClientsPage = overview?.clients;

  const clients = useMemo(() => {
    const initialClients = initialClientsPage?.data ?? [];
    return [...initialClients, ...extraClientPages.flat()];
  }, [extraClientPages, initialClientsPage?.data]);

  const hasMoreClients = Boolean(
    initialClientsPage && 1 + extraClientPages.length < initialClientsPage.totalPages
  );

  const fetchNextClients = async () => {
    if (!initialClientsPage || isFetchingNextClients || !hasMoreClients) return;

    setIsFetchingNextClients(true);
    try {
      const nextPage = 2 + extraClientPages.length;
      const page = await fetchDashboardClientPage(nextPage, initialClientsPage.limit);
      setExtraClientPages((prev) => [...prev, page.data]);
    } finally {
      setIsFetchingNextClients(false);
    }
  };

  const refetchClients = async () => {
    setExtraClientPages([]);
    await refetchOverview();
  };

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

  const selectedClientData = useMemo(() => {
    if (!selectedClient) return null;
    return clients.find((client) => client.id === selectedClient.id) ?? selectedClient;
  }, [clients, selectedClient]);

  const selectedClientContractInfo = useMemo(() => {
    if (!selectedClientData) {
      return null;
    }

    const isDummyClient = selectedClientData.name.includes("[더미]");
    const hasContractSignal = Boolean(selectedClientData.eDocId || selectedClientData.documentStatus);

    if (!isDummyClient && !hasContractSignal) {
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
  }, [selectedClientData, locale]);

  if (!user) {
    redirect("/logout");
  }

  return (
    <section
      data-component="dashboard"
      className="flex flex-col gap-4 h-[calc(100dvh-11rem)] md:h-[calc(100dvh-4rem)]"
    >
      <Block name="dashboard-stats" className="shrink-0">
        <StatsBar
          name="dashboard"
          isLoading={overviewLoading}
          items={DASHBOARD_STAT_KEYS.map((s) => ({
            icon: s.icon,
            value: stats?.[s.valueKey] ?? 0,
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
          onBack={() => setSelectedClient(null)}
        >
          <Block name="dashboard-activities-panel" className="h-full min-h-0">
            <RecentActivitiesPanel
              actionRequiredItems={actionRequiredClients}
              upcomingItems={upcomingClients}
              isLoading={overviewLoading}
              isError={overviewError}
              onRetry={() => refetchClients()}
              selectedId={selectedClientData?.id}
              onSelect={setSelectedClient}
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
                    "w-16 h-16 rounded-[20px] flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0",
                    getAvatarGradient(selectedClientData.name)
                  )}
                >
                  {selectedClientData.name.charAt(0)}
                </div>
              }
              title={selectedClientData.name}
              badges={
                <>
                  <StatusBadge
                    status={mapServiceStatusToV3(selectedClientData.serviceStatus)}
                    label={getStatusLabel(selectedClientData.serviceStatus)}
                  />
                  {selectedClientData.breastPump && (
                    <StatusBadge status="breastPump" />
                  )}
                  {selectedClientData.careCenter && (
                    <StatusBadge status="careCenter" />
                  )}
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
                    <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-v3-dim-white transition-colors">
                      <MoreVertical className="w-5 h-5 text-v3-text-muted" />
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
                    { key: "alimtalk", label: "알림톡 발송 현황" },
                  ]}
                  activeTab={activeDetailTab}
                  onTabChange={setActiveDetailTab}
                />
              }
            >
              <DetailTabPanels
                activeTab={activeDetailTab}
                dataComponent="dashboard-detail-content"
                panelDataComponent="dashboard-detail-content-panel"
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
                      <div data-component="dashboard-detail-contracts-empty" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                        계약서 정보가 없습니다
                      </div>
                    ),
                  },
                  {
                    key: "alimtalk",
                    children: (
                      <div data-component="dashboard-detail-alimtalk-empty" className="text-center py-12 text-v3-text-muted text-[0.85rem]">
                        알림톡 발송 현황이 없습니다
                      </div>
                    ),
                  },
                ]}
              />
            </DetailPanel>
          ) : (
            <Block
              name="dashboard-detail-empty"
              className="bg-white rounded-[28px] shadow-v3 flex items-center justify-center h-full"
            >
              <div data-component="dashboard-detail-empty-message" className="text-center text-v3-text-muted">
                <p className="text-[0.8rem] font-semibold">
                  항목을 선택하면 상세 정보가 표시됩니다
                </p>
              </div>
            </Block>
          )}
        </SplitLayout>
      </Block>
    </section>
  );
}
