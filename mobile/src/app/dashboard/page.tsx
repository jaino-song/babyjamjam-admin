"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { useMemo, useState } from "react";

import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useClients } from "@/hooks/useClients";
import { Client } from "@/lib/client/types";
import { useInitialUser } from "@/providers/UserProvider";
import { cn } from "@/lib/utils";
import {
  StatsBar,
  SplitLayout,
  DetailPanel,
  InfoCard,
  InfoRow,
  StatusBadge,
  RecentActivitiesPanel,
  type ActionRequiredItem,
  type StatusType,
} from "@/components/app/v3";
import {
  Users,
  Calendar,
  FileSignature,
  Send,
  Phone,
  FileText,
  User,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { HeroBanner } from "@/components/app/dashboard/HeroBanner";
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
    case "pending":
    case "replacement_requested":
      return "pending";
    case "terminated":
    case "cancelled":
      return "expired";
    case "completed":
      return "completed";
    default:
      return "pending";
  }
};

const getStatusLabel = (status: string | null): string => {
  switch (status) {
    case "active":
      return "진행중";
    case "waiting":
    case "pending":
      return "대기";
    case "replacement_requested":
      return "교체 요청";
    case "completed":
      return "완료";
    case "terminated":
    case "cancelled":
      return "중단";
    default:
      return "-";
  }
};

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const {
    data: clientsData,
    isLoading: clientsLoading,
    isError: clientsError,
    refetch: refetchClients,
  } = useClients(1, 50);
  const user = useInitialUser();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);

  const clients = useMemo(() => clientsData?.data ?? [], [clientsData?.data]);
  const hasMoreClients = (clientsData?.total ?? 0) > 50;

  const actionRequiredClients = useMemo(() => {
    return clients
      .filter((c) => {
        const needsSignature = c.documentStatus && c.documentStatus !== "completed" && c.eDocId;
        const notSent = !c.eDocId && c.serviceStatus === "active";
        const replacementRequested = c.serviceStatus === "replacement_requested";
        return needsSignature || notSent || replacementRequested;
      })
      .map((c): ActionRequiredItem => {
        let reason: string;
        let priority: number;

        if (c.serviceStatus === "replacement_requested") {
          reason = "교체 요청";
          priority = 1;
        } else if (c.documentStatus && c.documentStatus !== "completed" && c.eDocId) {
          reason = "서명 대기";
          priority = 2;
        } else {
          reason = "발송 대기";
          priority = 3;
        }

        return { client: c, reason, priority };
      })
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

  if (!user) {
    redirect("/logout");
  }

  return (
    <section
      data-component="dashboard"
      className="space-y-6"
    >
      <HeroBanner
        title={user?.name ? `${user?.name} 님` : "다시 로그인 해주세요"}
        subtitle={user?.organizationName ?? ""}
        isLoading={statsLoading}
      />

      <Block name="dashboard-stats">
        <StatsBar
          name="dashboard"
          isLoading={statsLoading}
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
      >
        <SplitLayout
          hasSelection={!!selectedClientData}
          onBack={() => setSelectedClient(null)}
        >
          <Block name="dashboard-activities-panel">
            <RecentActivitiesPanel
              actionRequiredItems={actionRequiredClients}
              upcomingItems={upcomingClients}
              isLoading={clientsLoading}
              isError={clientsError}
              onRetry={() => refetchClients()}
              selectedId={selectedClientData?.id}
              onSelect={setSelectedClient}
              hasMore={hasMoreClients}
            />
          </Block>

          {selectedClientData ? (
            <DetailPanel
              avatar={
                <div
                  className={cn(
                    "w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold text-white shadow-lg shrink-0",
                    getAvatarGradient(selectedClientData.name)
                  )}
                >
                  {selectedClientData.name.charAt(0)}
                </div>
              }
              title={selectedClientData.name}
              badges={
                <StatusBadge
                  status={mapServiceStatusToV3(selectedClientData.serviceStatus)}
                  label={getStatusLabel(selectedClientData.serviceStatus)}
                />
              }
              subtitle={
                <>
                  {selectedClientData.type || "일반"} ·{" "}
                  {selectedClientData.duration ? `${selectedClientData.duration}일` : "-"}
                </>
              }
            >
              <div className="space-y-4">
                <div className="flex gap-2">
                  {selectedClientData.phone ? (
                    <Button
                      asChild
                      variant="ghost"
                      className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-2xl"
                    >
                      <a href={`tel:${selectedClientData.phone}`}>
                        <Phone className="w-4 h-4" />
                        <span className="text-[10px] font-semibold">전화</span>
                      </a>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled
                      className="flex-1 flex-col h-auto py-3 gap-1 rounded-2xl"
                    >
                      <Phone className="w-4 h-4" />
                      <span className="text-[10px] font-semibold">전화</span>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-2xl"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span className="text-[10px] font-semibold">메시지</span>
                  </Button>
                  <Button
                    asChild
                    variant="ghost"
                    className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-2xl"
                  >
                    <Link href={`/clients?id=${selectedClientData.id}`}>
                      <User className="w-4 h-4" />
                      <span className="text-[10px] font-semibold">고객상세</span>
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="ghost"
                    className="flex-1 flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-2xl"
                  >
                    <Link href={`/contracts?clientId=${selectedClientData.id}`}>
                      <FileText className="w-4 h-4" />
                      <span className="text-[10px] font-semibold">계약</span>
                    </Link>
                  </Button>
                </div>

                <InfoCard title="기본 정보">
                  <InfoRow label="이름" value={selectedClientData.name} />
                  <InfoRow label="연락처" value={selectedClientData.phone || "-"} />
                  <InfoRow label="주소" value={selectedClientData.address || "-"} />
                  <InfoRow label="출산예정일" value={selectedClientData.dueDate || "-"} />
                </InfoCard>

                <InfoCard title="서비스 정보">
                  <InfoRow label="바우처 유형" value={selectedClientData.type || "-"} />
                  <InfoRow
                    label="기간"
                    value={selectedClientData.duration ? `${selectedClientData.duration}일` : "-"}
                  />
                  <InfoRow label="시작일" value={selectedClientData.startDate ? new Date(selectedClientData.startDate).toLocaleDateString("ko-KR") : "-"} />
                  <InfoRow label="종료일" value={selectedClientData.endDate ? new Date(selectedClientData.endDate).toLocaleDateString("ko-KR") : "-"} />
                  <InfoRow
                    label="담당 직원"
                    value={selectedClientData.primaryEmployee?.name || "-"}
                  />
                </InfoCard>

                <InfoCard title="이용 현황">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge
                      status={selectedClientData.voucherClient ? "active" : "expired"}
                      label="바우처"
                    />
                    <StatusBadge
                      status={selectedClientData.careCenter ? "active" : "expired"}
                      label="산후조리원"
                    />
                    <StatusBadge
                      status={selectedClientData.breastPump ? "active" : "expired"}
                      label="유축기 대여"
                    />
                  </div>
                </InfoCard>
              </div>
            </DetailPanel>
          ) : (
            <Block
              name="dashboard-detail-empty"
              className="bg-white rounded-2xl shadow-v3 flex items-center justify-center min-h-[400px]"
            >
              <div className="text-center text-v3-text-muted">
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
