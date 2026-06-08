"use client";

import { redirect, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, File, Send, User } from "lucide-react";

const ALL_FILTER = "전체";
const DASHBOARD_ROUTE_BODY_CLASS = "mobile-dashboard-route";

import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { useClients, useDeleteClient } from "@/hooks/useClients";
import { useSyncStaleEformsignStatuses } from "@/hooks/useSyncStaleEformsignStatuses";
import type { Client } from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { toast } from "@/hooks/use-toast";
import { useInitialUser } from "@/providers/UserProvider";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { ClientDetailContent, type DetailTabId } from "@/components/app/clients/client-detail";
import { DashboardRedesign } from "@/components/app/mobile-redesign/DashboardRedesign";
import { diffBusinessDaysKr, isoDateInKorea } from "@/lib/date/business-days";
import { deriveDashboardAnalyticsFromClients } from "@/lib/dashboard/analytics";
import type {
  DashboardRedesignFilter,
  DashboardRedesignProps,
} from "@/components/app/mobile-redesign/DashboardRedesign";
import { MobileDetailSheet } from "@/components/app/mobile-redesign/detail-sheet";
import type {
  DashboardAnalytic,
  ListRow,
  SectionRows,
} from "@/components/app/mobile-redesign/mockup-data";
import "@/components/app/mobile-redesign/redesign.css";

const AVATAR_TONES: NonNullable<ListRow["avatarTone"]>[] = [
  "primary",
  "green",
  "burgundy",
  "orange",
  "purple",
];

function pickAvatarTone(name: string, fallback: number): NonNullable<ListRow["avatarTone"]> {
  const code = name.charCodeAt(0) || fallback;
  return AVATAR_TONES[code % AVATAR_TONES.length];
}

function clientInitial(name: string) {
  return name.trim().charAt(0) || "?";
}

function clientMeta(c: Client) {
  const type = c.type ?? "유형 미정";
  return c.primaryEmployee?.name ? `${type} · ${c.primaryEmployee.name}` : `${type} · 제공인력 미배정`;
}

function dayDiff(targetISO: string | null) {
  if (!targetISO) return null;
  const target = new Date(targetISO);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function formatMonthDay(diff: number) {
  const d = new Date();
  d.setDate(d.getDate() + diff);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function normalizeIsoDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return isoDateInKorea(date);
}

function formatMonthDayFromIso(iso: string) {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

interface DueInfo {
  due: string;
  dueSub?: string;
  dueTone?: "urgent" | "soon";
}

type DashboardStatusBadge = {
  label: string;
  tone: ListRow["badgeTone"];
  order: number;
};

type DashboardStatusRow = ListRow & {
  badges: DashboardStatusBadge[];
  statusOrder: number;
};

const DASHBOARD_STATUS_ORDER = {
  waiting: 10,
  upcoming: 20,
  sendPending: 30,
  reviewNeeded: 40,
  active: 50,
  replacementRequested: 60,
} as const;

function dueForStart(diff: number): DueInfo {
  if (diff < 0) return { due: `D+${Math.abs(diff)}`, dueSub: "지남" };
  if (diff === 0) return { due: "오늘", dueSub: "시작", dueTone: "urgent" };
  if (diff === 1) return { due: "D-1", dueSub: "내일까지", dueTone: "urgent" };
  if (diff <= 7) return { due: `D-${diff}`, dueSub: formatMonthDay(diff), dueTone: "soon" };
  return { due: `D-${diff}`, dueSub: formatMonthDay(diff) };
}

function dueForUpcomingStart(diff: number): DueInfo {
  if (diff <= 0) return dueForStart(diff);
  if (diff === 1) return { due: "1일 남음", dueSub: "내일까지", dueTone: "urgent" };
  if (diff <= 7) return { due: `${diff}일 남음`, dueSub: formatMonthDay(diff), dueTone: "soon" };
  return { due: `${diff}일 남음`, dueSub: formatMonthDay(diff) };
}

function dueForEndDate(endDate: string | null): DueInfo | null {
  const endIso = normalizeIsoDate(endDate);
  if (!endIso) return null;

  const diff = diffBusinessDaysKr(endIso);
  if (diff === null) return null;

  const dueSub = `~${formatMonthDayFromIso(endIso)}`;
  if (diff < 0) return { due: `D+${Math.abs(diff)}`, dueSub: "지남" };
  if (diff === 0) return { due: "종료", dueSub: "오늘", dueTone: "urgent" };
  if (diff <= 3) return { due: `${diff}일 남음`, dueSub, dueTone: "urgent" };
  if (diff <= 7) return { due: `${diff}일 남음`, dueSub, dueTone: "soon" };
  return { due: `${diff}일 남음`, dueSub };
}

function withDashboardStatus(row: ListRow, statusOrder: number): DashboardStatusRow {
  return {
    ...row,
    badges: [{ label: row.badge, tone: row.badgeTone, order: statusOrder }],
    statusOrder,
  };
}

function compactDashboardBadges(
  badges: DashboardStatusBadge[],
): Array<{ label: string; tone: ListRow["badgeTone"] }> {
  const byLabel = new Map<string, DashboardStatusBadge>();

  for (const badge of badges) {
    const existing = byLabel.get(badge.label);
    if (!existing || badge.order >= existing.order) {
      byLabel.set(badge.label, badge);
    }
  }

  const ordered = [...byLabel.values()].sort((a, b) => a.order - b.order);
  const visible =
    ordered.length > 2
      ? [{ label: "...", tone: "muted" as const, order: Number.NEGATIVE_INFINITY }, ...ordered.slice(-2)]
      : ordered;

  return visible.map(({ label, tone }) => ({ label, tone }));
}

function mergeDashboardRows(rows: DashboardStatusRow[]): ListRow[] {
  const mergedRows: Array<
    DashboardStatusRow & {
      sourceIndex: number;
      fullBadges: DashboardStatusBadge[];
    }
  > = [];
  const byClient = new Map<string | number, (typeof mergedRows)[number]>();

  rows.forEach((row, index) => {
    const key = row.id ?? `${row.name}-${row.meta}`;
    const existing = byClient.get(key);

    if (!existing) {
      const merged = {
        ...row,
        sourceIndex: index,
        fullBadges: [...row.badges],
      };
      byClient.set(key, merged);
      mergedRows.push(merged);
      return;
    }

    existing.fullBadges.push(...row.badges);

    if (row.statusOrder >= existing.statusOrder) {
      existing.badge = row.badge;
      existing.badgeTone = row.badgeTone;
      existing.due = row.due;
      existing.dueSub = row.dueSub;
      existing.dueTone = row.dueTone;
      existing.statusOrder = row.statusOrder;
    }
  });

  return mergedRows
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map((row) => ({
      id: row.id,
      name: row.name,
      meta: row.meta,
      initial: row.initial,
      badge: row.badge,
      badgeTone: row.badgeTone,
      badges: compactDashboardBadges(row.fullBadges),
      due: row.due,
      dueSub: row.dueSub,
      dueTone: row.dueTone,
      avatarTone: row.avatarTone,
      onClick: row.onClick,
    }));
}

export default function DashboardPage() {
  // 60s staleTime: dashboard revisits within the window reuse the cache
  // instead of re-firing analytics + clients (and the eformsign sync burst
  // their invalidations cascade into) on every mount.
  const { data: analytics, isLoading: analyticsLoading } = useDashboardAnalytics({
    staleTime: 60_000,
  });
  const { data: clientsData, isLoading: clientsLoading } = useClients(1, 50, undefined, {
    staleTime: 60_000,
  });
  const user = useInitialUser();
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);

  const clients = useMemo<Client[]>(() => clientsData?.data ?? [], [clientsData?.data]);
  useSyncStaleEformsignStatuses(clients, { enabled: !clientsLoading });

  useEffect(() => {
    document.body.classList.add(DASHBOARD_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(DASHBOARD_ROUTE_BODY_CLASS);
    };
  }, []);

  const router = useRouter();
  const locale = useLocale();
  const deleteClient = useDeleteClient();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTabId>("basic");
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);

  const openClient = useCallback((c: Client) => {
    setSelectedClient(c);
    setDetailTab("basic");
  }, []);
  const closeDetail = useCallback(() => setSelectedClient(null), []);
  const handleEdit = useCallback((c: Client) => {
    setEditingClient(c);
    setFormDialogOpen(true);
  }, []);
  const handleMessage = useCallback((c: Client) => router.push(`/messages?clientId=${c.id}`), [router]);
  const handleIssueContract = useCallback(() => router.push("/contracts/new"), [router]);
  const handleDeleteRequest = useCallback((id: number) => setDeleteTargetClientId(id), []);
  const handleDeleteConfirm = async () => {
    if (deleteTargetClientId == null) return;
    try {
      await deleteClient.mutateAsync(deleteTargetClientId);
      if (selectedClient?.id === deleteTargetClientId) setSelectedClient(null);
      setDeleteTargetClientId(null);
      toast({
        title: t(locale, "clients.delete-success"),
        description: t(locale, "clients.delete-success-description"),
      });
    } catch {
      toast({
        title: t(locale, "clients.delete-fail"),
        description: t(locale, "clients.delete-fail-description"),
        variant: "destructive",
      });
    }
  };

  const dashboardData = useMemo<
    Omit<DashboardRedesignProps, "activeFilter" | "onFilterChange"> & { allRows: ListRow[] }
  >(() => {
    const derivedAnalytics = deriveDashboardAnalyticsFromClients(clients);
    const active = analytics?.activeClients ?? derivedAnalytics.activeClients;
    const upcoming = analytics?.upcomingThisMonth ?? derivedAnalytics.upcomingThisMonth;
    const pendingReview =
      analytics?.contractsPendingSignature ?? derivedAnalytics.contractsPendingSignature;
    const pendingSend = analytics?.contractsNotSent ?? derivedAnalytics.contractsNotSent;

    const dashboardAnalytics: DashboardAnalytic[] = [
      { label: "서비스 진행 중", value: String(active), tone: "primary", icon: User },
      { label: "7일 내 시작 예정", value: String(upcoming), tone: "orange", icon: Calendar },
      {
        label: "검토 필요 문서",
        value: String(pendingReview),
        tone: "green",
        icon: File,
        urgent: pendingReview > 0,
      },
      {
        label: "계약서 미완료",
        value: String(pendingSend),
        tone: "burgundy",
        icon: Send,
        urgent: pendingSend > 0,
      },
    ];

    if (clientsLoading) {
      const filters: DashboardRedesignFilter[] = [
        { label: ALL_FILTER, count: "", skeleton: true },
        { label: "조치 필요", count: "", skeleton: true },
        { label: "시작 예정", count: "", skeleton: true },
        { label: "종료 예정", count: "", skeleton: true },
      ];

      return { analytics: dashboardAnalytics, sections: [], filters, allRows: [], loading: true };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);
    weekFromNow.setHours(23, 59, 59, 999);
    const monthFromNow = new Date(today);
    monthFromNow.setDate(today.getDate() + 30);
    monthFromNow.setHours(23, 59, 59, 999);

    const actionRequired = clients
      .filter((c) => {
        if (c.serviceStatus === "replacement_requested") return true;
        if (c.documentStatus && c.documentStatus !== "completed" && c.eDocId) return true;
        if (!c.eDocId && c.serviceStatus === "active") return true;
        return false;
      })
      .sort((a, b) => (b.updatedAt ? new Date(b.updatedAt).getTime() : 0) - (a.updatedAt ? new Date(a.updatedAt).getTime() : 0) || b.id - a.id);

    const upcomingClients = clients
      .filter((c) => {
        if (!c.startDate || c.serviceStatus === "terminated")
          return false;
        const d = new Date(c.startDate);
        if (Number.isNaN(d.getTime())) return false;
        d.setHours(0, 0, 0, 0);
        return d >= today && d <= weekFromNow;
      })
      .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());

    const endingSoon = clients
      .filter((c) => {
        if (!c.endDate || c.serviceStatus !== "active") return false;
        const d = new Date(c.endDate);
        if (Number.isNaN(d.getTime())) return false;
        d.setHours(0, 0, 0, 0);
        return d >= today && d <= monthFromNow;
      })
      .sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime());

    const toActionRow = (c: Client, i: number): DashboardStatusRow => {
      let badge: string;
      let badgeTone: ListRow["badgeTone"];
      let dueInfo: DueInfo | null = null;
      let statusOrder: number;

      if (c.serviceStatus === "replacement_requested") {
        badge = "교체 요청";
        badgeTone = "burgundy";
        dueInfo = { due: "긴급", dueSub: "오늘", dueTone: "urgent" };
        statusOrder = DASHBOARD_STATUS_ORDER.replacementRequested;
      } else if (c.documentStatus && c.documentStatus !== "completed" && c.eDocId) {
        badge = "검토 필요";
        badgeTone = "primary";
        const diff = dayDiff(c.startDate);
        if (diff !== null) dueInfo = dueForStart(diff);
        statusOrder = DASHBOARD_STATUS_ORDER.reviewNeeded;
      } else {
        badge = "발송 대기";
        badgeTone = "orange";
        const diff = dayDiff(c.startDate);
        if (diff !== null) dueInfo = dueForStart(diff);
        statusOrder = DASHBOARD_STATUS_ORDER.sendPending;
      }

      return withDashboardStatus({
        id: c.id,
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge,
        badgeTone,
        avatarTone: pickAvatarTone(c.name, i),
        onClick: () => openClient(c),
        ...(dueInfo ?? {}),
      }, statusOrder);
    };

    const toUpcomingRow = (c: Client, i: number): DashboardStatusRow => {
      const diff = dayDiff(c.startDate);
      const dueInfo = diff !== null ? dueForUpcomingStart(diff) : null;
      const hasEmployee = Boolean(c.primaryEmployee);
      return withDashboardStatus({
        id: c.id,
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge: hasEmployee ? "예정" : "대기",
        badgeTone: hasEmployee ? "primary" : "muted",
        avatarTone: pickAvatarTone(c.name, i),
        onClick: () => openClient(c),
        ...(dueInfo ?? {}),
      }, hasEmployee ? DASHBOARD_STATUS_ORDER.upcoming : DASHBOARD_STATUS_ORDER.waiting);
    };

    const toEndingRow = (c: Client, i: number): DashboardStatusRow => {
      const dueInfo = dueForEndDate(c.endDate);
      return withDashboardStatus({
        id: c.id,
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge: "진행중",
        badgeTone: "primary",
        avatarTone: pickAvatarTone(c.name, i),
        onClick: () => openClient(c),
        ...(dueInfo ?? {}),
      }, DASHBOARD_STATUS_ORDER.active);
    };

    const actionRows = actionRequired.map(toActionRow);
    const upcomingRows = upcomingClients.map(toUpcomingRow);
    const endingRows = endingSoon.map(toEndingRow);
    const allRows = mergeDashboardRows([...actionRows, ...upcomingRows, ...endingRows]);

    const allSections: SectionRows[] = [
      { title: `조치 필요 · ${actionRows.length}건`, rows: actionRows },
      { title: `시작 예정 · ${upcomingRows.length}명`, rows: upcomingRows },
      { title: `종료 예정 · ${endingRows.length}명`, rows: endingRows },
    ].filter((s) => s.rows.length > 0);

    const filters: DashboardRedesignFilter[] = [
      { label: ALL_FILTER, count: String(allRows.length) },
      { label: "조치 필요", count: String(actionRows.length) },
      { label: "시작 예정", count: String(upcomingRows.length) },
      { label: "종료 예정", count: String(endingRows.length) },
    ];

    return { analytics: dashboardAnalytics, sections: allSections, filters, allRows, loading: false };
  }, [analytics, clients, clientsLoading, openClient]);

  const visibleSections = useMemo(() => {
    if (activeFilter === ALL_FILTER) {
      return dashboardData.allRows.length > 0
        ? [{ title: `${ALL_FILTER} · ${dashboardData.allRows.length}건`, rows: dashboardData.allRows }]
        : [];
    }
    return dashboardData.sections.filter((s) => s.title.startsWith(activeFilter));
  }, [dashboardData.allRows, dashboardData.sections, activeFilter]);

  if (!user) {
    redirect("/logout");
  }

  return (
    <>
      <MobileDetailSheet
        name="dashboard"
        isOpen={Boolean(selectedClient)}
        onClose={closeDetail}
        list={
          <DashboardRedesign
            analytics={dashboardData.analytics}
            sections={visibleSections}
            filters={dashboardData.filters}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            analyticsLoading={(analyticsLoading || clientsLoading) && !analytics}
            loading={dashboardData.loading}
          />
        }
        detail={
          selectedClient ? (
            <ClientDetailContent
              client={selectedClient}
              activeTab={detailTab}
              onTabChange={setDetailTab}
              onMessage={() => handleMessage(selectedClient)}
              onIssueContract={handleIssueContract}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
            />
          ) : (
            <div className="detail-body" data-component="mobile-dashboard-detail-empty" />
          )
        }
      />

      <ConfirmActionModal
        open={deleteTargetClientId != null}
        title={t(locale, "common.delete")}
        description={t(locale, "clients.delete-confirm")}
        cancelLabel={t(locale, "common.cancel")}
        confirmLabel={t(locale, "common.delete")}
        loading={deleteClient.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteClient.isPending) {
            setDeleteTargetClientId(null);
          }
        }}
        onCancel={() => setDeleteTargetClientId(null)}
        onConfirm={handleDeleteConfirm}
      />

      <ClientFormDialog
        open={formDialogOpen}
        onClose={() => {
          setFormDialogOpen(false);
          setEditingClient(null);
        }}
        client={editingClient}
      />
    </>
  );
}
