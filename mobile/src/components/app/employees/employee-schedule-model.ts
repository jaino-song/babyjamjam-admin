import type { Client } from "@/lib/client/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

export type ScheduleKind = "start" | "end" | "replacement";

export interface ScheduleEntry {
  id: string;
  clientId: number;
  clientName: string;
  employeeName: string | null;
  kind: ScheduleKind;
  dateISO: string;
  dateKey: string;
  dateLabel: string;
  title: string;
  meta: string;
}

export interface CalendarDay {
  date: Date;
  dateKey: string;
  isCurrentMonth: boolean;
  isInHorizon: boolean;
}

export interface ScheduleMonthRange {
  minMonthKey: string;
  maxMonthKey: string;
  horizonStart: Date;
  horizonEnd: Date;
}

export const SCHEDULE_KIND_LABELS: Record<ScheduleKind, string> = {
  start: "서비스 시작",
  end: "서비스 종료",
  replacement: "교체 요청",
};

export const SCHEDULE_KIND_FILTERS = [
  { key: "all", label: "전체" },
  { key: "start", label: SCHEDULE_KIND_LABELS.start },
  { key: "end", label: SCHEDULE_KIND_LABELS.end },
  { key: "replacement", label: SCHEDULE_KIND_LABELS.replacement },
] as const;

export type ScheduleKindFilter = (typeof SCHEDULE_KIND_FILTERS)[number]["key"];

export const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function dateKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function startOfMonth(value: Date): Date {
  const date = startOfDay(value);
  date.setDate(1);
  return date;
}

export function addDays(value: Date, amount: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return startOfDay(date);
}

/**
 * Parse a schedule date and reject impossible calendar dates such as 2027-02-31.
 * API timestamps still use the native parser so timezone-bearing values keep the
 * same local-day behavior as the desktop schedule.
 */
export function parseScheduleDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return startOfDay(date);
}

export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatScheduleDate(date: Date): string {
  return formatDateForDisplay(date, "-");
}

export function formatMonthLabel(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

export function formatFullDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

export function formatSelectedDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

export function getScheduleHorizon(now: Date): { horizonStart: Date; horizonEnd: Date } {
  const horizonStart = new Date(2026, 0, 1);
  const today = startOfDay(now);
  const horizonEnd = new Date(today);
  const targetYear = today.getFullYear() + 1;
  const month = today.getMonth();
  const lastDay = new Date(targetYear, month + 1, 0).getDate();
  // Clamp Feb 29 to Feb 28 in the following non-leap year.
  horizonEnd.setFullYear(targetYear, month, Math.min(today.getDate(), lastDay));
  horizonEnd.setHours(23, 59, 59, 999);
  return { horizonStart, horizonEnd };
}

export function getScheduleMonthRange(now: Date = new Date()): ScheduleMonthRange {
  const { horizonStart, horizonEnd } = getScheduleHorizon(now);
  return {
    minMonthKey: monthKey(horizonStart),
    maxMonthKey: monthKey(horizonEnd),
    horizonStart,
    horizonEnd,
  };
}

export function buildMonthCalendarDays(
  month: Date,
  horizonStart: Date,
  horizonEnd: Date,
): CalendarDay[] {
  const monthStart = startOfMonth(month);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const gridEnd = addDays(monthEnd, 6 - monthEnd.getDay());
  const normalizedHorizonStart = startOfDay(horizonStart);
  const normalizedHorizonEnd = startOfDay(horizonEnd);
  const days: CalendarDay[] = [];

  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) {
    const currentDate = startOfDay(cursor);
    days.push({
      date: currentDate,
      dateKey: dateKey(currentDate),
      isCurrentMonth:
        currentDate.getMonth() === monthStart.getMonth() &&
        currentDate.getFullYear() === monthStart.getFullYear(),
      isInHorizon: currentDate >= normalizedHorizonStart && currentDate <= normalizedHorizonEnd,
    });
  }

  return days;
}

export function canNavigateToMonth(month: Date, range: ScheduleMonthRange): boolean {
  const key = monthKey(month);
  return key >= range.minMonthKey && key <= range.maxMonthKey;
}

export function moveMonth(month: Date, amount: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + amount, 1);
}

function clientEmployeeMeta(client: Client): string {
  return client.primaryEmployee?.name ? `${client.primaryEmployee.name} 담당` : "제공인력 미배정";
}

function employeeName(client: Client): string | null {
  return client.primaryEmployee?.name ?? null;
}

/**
 * Build schedule events from January 2026 through the inclusive same day in
 * the following year. Replacement requests are surfaced on today; service
 * dates are included only while they fall inside the horizon.
 */
export function buildScheduleEntries(clients: Client[], now: Date = new Date()): ScheduleEntry[] {
  const { horizonStart, horizonEnd } = getScheduleHorizon(now);
  const today = startOfDay(now);
  const entries: ScheduleEntry[] = [];

  for (const client of clients) {
    const caregiver = employeeName(client);
    const meta = clientEmployeeMeta(client);

    if (client.serviceStatus === "replacement_requested") {
      entries.push({
        id: `${client.id}-replacement`,
        clientId: client.id,
        clientName: client.name,
        employeeName: caregiver,
        kind: "replacement",
        dateISO: today.toISOString(),
        dateKey: dateKey(today),
        dateLabel: formatScheduleDate(today),
        title: `${client.name} 교체 요청`,
        meta,
      });
    }

    const startDate = parseScheduleDate(client.startDate);
    if (
      startDate &&
      client.serviceStatus !== "terminated" &&
      startDate >= horizonStart &&
      startDate <= horizonEnd
    ) {
      entries.push({
        id: `${client.id}-start`,
        clientId: client.id,
        clientName: client.name,
        employeeName: caregiver,
        kind: "start",
        dateISO: startDate.toISOString(),
        dateKey: dateKey(startDate),
        dateLabel: formatScheduleDate(startDate),
        title: `${client.name} 서비스 시작`,
        meta,
      });
    }

    const endDate = parseScheduleDate(client.endDate);
    if (
      endDate &&
      client.serviceStatus === "active" &&
      endDate >= horizonStart &&
      endDate <= horizonEnd
    ) {
      entries.push({
        id: `${client.id}-end`,
        clientId: client.id,
        clientName: client.name,
        employeeName: caregiver,
        kind: "end",
        dateISO: endDate.toISOString(),
        dateKey: dateKey(endDate),
        dateLabel: formatScheduleDate(endDate),
        title: `${client.name} 서비스 종료`,
        meta,
      });
    }
  }

  return entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.id.localeCompare(b.id));
}

export function filterScheduleEntries(
  entries: ScheduleEntry[],
  kind: ScheduleKindFilter,
  search: string,
): ScheduleEntry[] {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (kind !== "all" && entry.kind !== kind) return false;
    if (!normalizedSearch) return true;
    return [entry.clientName, entry.employeeName, entry.title, entry.meta]
      .filter(Boolean)
      .some((value) => value!.toLocaleLowerCase().includes(normalizedSearch));
  });
}
