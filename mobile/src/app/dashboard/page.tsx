"use client";

import { redirect } from "next/navigation";
import { useMemo, useState } from "react";
import { Calendar, File, Send, User } from "lucide-react";

const ALL_FILTER = "전체";

import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useClients } from "@/hooks/useClients";
import type { Client } from "@/lib/client/types";
import { useInitialUser } from "@/providers/UserProvider";
import { DashboardRedesign } from "@/components/app/mobile-redesign/DashboardRedesign";
import type {
  DashboardRedesignFilter,
  DashboardRedesignProps,
} from "@/components/app/mobile-redesign/DashboardRedesign";
import type {
  DashboardStat,
  ListRow,
  SectionRows,
} from "@/components/app/mobile-redesign/mockup-data";

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

interface DueInfo {
  due: string;
  dueSub: string;
  dueTone?: "urgent" | "soon";
}

function dueForStart(diff: number): DueInfo {
  if (diff < 0) return { due: `D+${Math.abs(diff)}`, dueSub: "지남" };
  if (diff === 0) return { due: "오늘", dueSub: "시작", dueTone: "urgent" };
  if (diff === 1) return { due: "D-1", dueSub: "내일까지", dueTone: "urgent" };
  if (diff <= 7) return { due: `D-${diff}`, dueSub: formatMonthDay(diff), dueTone: "soon" };
  return { due: `D-${diff}`, dueSub: formatMonthDay(diff) };
}

function dueForEnd(diff: number): DueInfo {
  if (diff < 0) return { due: `D+${Math.abs(diff)}`, dueSub: "지남" };
  if (diff === 0) return { due: "종료", dueSub: "오늘", dueTone: "urgent" };
  if (diff <= 3) return { due: `D-${diff}`, dueSub: `~${formatMonthDay(diff)}`, dueTone: "urgent" };
  if (diff <= 7) return { due: `D-${diff}`, dueSub: `~${formatMonthDay(diff)}`, dueTone: "soon" };
  return { due: `D-${diff}`, dueSub: `~${formatMonthDay(diff)}` };
}

export default function DashboardPage() {
  const { data: stats } = useDashboardStats();
  const { data: clientsData } = useClients(1, 50);
  const user = useInitialUser();
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);

  const clients = useMemo<Client[]>(() => clientsData?.data ?? [], [clientsData?.data]);

  const dashboardData = useMemo<Omit<DashboardRedesignProps, "activeFilter" | "onFilterChange">>(() => {
    const active = stats?.activeClients ?? 0;
    const upcoming = stats?.upcomingThisMonth ?? 0;
    const pendingReview = stats?.contractsPendingSignature ?? 0;
    const pendingSend = stats?.contractsNotSent ?? 0;

    const dashboardStats: DashboardStat[] = [
      { label: "서비스 진행 중", value: String(active), tone: "primary", icon: User },
      { label: "이번달 시작 예정", value: String(upcoming), tone: "orange", icon: Calendar },
      {
        label: "검토 필요 문서",
        value: String(pendingReview),
        tone: "green",
        icon: File,
        urgent: pendingReview > 0,
      },
      {
        label: "발송 대기 문서",
        value: String(pendingSend),
        tone: "burgundy",
        icon: Send,
        urgent: pendingSend > 0,
      },
    ];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);
    weekFromNow.setHours(23, 59, 59, 999);
    const monthFromNow = new Date(today);
    monthFromNow.setDate(today.getDate() + 30);
    monthFromNow.setHours(23, 59, 59, 999);

    const actionRequired = clients.filter((c) => {
      if (c.serviceStatus === "replacement_requested") return true;
      if (c.documentStatus && c.documentStatus !== "completed" && c.eDocId) return true;
      if (!c.eDocId && c.serviceStatus === "active") return true;
      return false;
    });

    const upcomingClients = clients
      .filter((c) => {
        if (!c.startDate || c.serviceStatus === "terminated" || c.serviceStatus === "cancelled")
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

    const toActionRow = (c: Client, i: number): ListRow => {
      let badge: string;
      let badgeTone: ListRow["badgeTone"];
      let dueInfo: DueInfo | null = null;

      if (c.serviceStatus === "replacement_requested") {
        badge = "교체 요청";
        badgeTone = "burgundy";
        dueInfo = { due: "긴급", dueSub: "오늘", dueTone: "urgent" };
      } else if (c.documentStatus && c.documentStatus !== "completed" && c.eDocId) {
        badge = "검토 필요";
        badgeTone = "primary";
        const diff = dayDiff(c.startDate);
        if (diff !== null) dueInfo = dueForStart(diff);
      } else {
        badge = "발송 대기";
        badgeTone = "orange";
        const diff = dayDiff(c.startDate);
        if (diff !== null) dueInfo = dueForStart(diff);
      }

      return {
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge,
        badgeTone,
        avatarTone: pickAvatarTone(c.name, i),
        ...(dueInfo ?? {}),
      };
    };

    const toUpcomingRow = (c: Client, i: number): ListRow => {
      const diff = dayDiff(c.startDate);
      const dueInfo = diff !== null ? dueForStart(diff) : null;
      const hasEmployee = Boolean(c.primaryEmployee);
      return {
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge: hasEmployee ? "예정" : "대기",
        badgeTone: hasEmployee ? "primary" : "muted",
        avatarTone: pickAvatarTone(c.name, i),
        ...(dueInfo ?? {}),
      };
    };

    const toEndingRow = (c: Client, i: number): ListRow => {
      const diff = dayDiff(c.endDate);
      const dueInfo = diff !== null ? dueForEnd(diff) : null;
      return {
        name: c.name,
        meta: clientMeta(c),
        initial: clientInitial(c.name),
        badge: "진행중",
        badgeTone: "primary",
        avatarTone: pickAvatarTone(c.name, i),
        ...(dueInfo ?? {}),
      };
    };

    const actionRows = actionRequired.map(toActionRow);
    const upcomingRows = upcomingClients.map(toUpcomingRow);
    const endingRows = endingSoon.map(toEndingRow);

    const allSections: SectionRows[] = [
      { title: `계약서 처리 필요 · ${actionRows.length}건`, rows: actionRows },
      { title: `시작 예정 · ${upcomingRows.length}명`, rows: upcomingRows },
      { title: `종료 예정 · ${endingRows.length}명`, rows: endingRows },
    ].filter((s) => s.rows.length > 0);

    const total = actionRows.length + upcomingRows.length + endingRows.length;
    const filters: DashboardRedesignFilter[] = [
      { label: ALL_FILTER, count: String(total) },
      { label: "계약서 처리 필요", count: String(actionRows.length) },
      { label: "시작 예정", count: String(upcomingRows.length) },
      { label: "종료 예정", count: String(endingRows.length) },
    ];

    return { stats: dashboardStats, sections: allSections, filters };
  }, [stats, clients]);

  const visibleSections = useMemo(() => {
    if (activeFilter === ALL_FILTER) return dashboardData.sections;
    return dashboardData.sections.filter((s) => s.title.startsWith(activeFilter));
  }, [dashboardData.sections, activeFilter]);

  if (!user) {
    redirect("/logout");
  }

  return (
    <DashboardRedesign
      stats={dashboardData.stats}
      sections={visibleSections}
      filters={dashboardData.filters}
      activeFilter={activeFilter}
      onFilterChange={setActiveFilter}
    />
  );
}
