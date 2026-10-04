import type { Client } from "@/lib/client/types";
import { isoDateInKorea, type KrBusinessDayCalendar } from "@/lib/date/business-days";

export interface DashboardDueInfo {
  due: string;
  dueSub?: string;
  dueTone?: "urgent" | "soon";
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return isoDateInKorea(date);
}

function businessDayDiff(
  targetDate: string | null | undefined,
  calendar: KrBusinessDayCalendar,
  today = new Date(),
) {
  const targetIso = normalizeIsoDate(targetDate);
  if (!targetIso) return null;
  try {
    return calendar.diffBusinessDays(targetIso, isoDateInKorea(today));
  } catch {
    // A year the branch calendar does not cover: show no due text rather than a wrong one.
    return null;
  }
}

function dueToneForBusinessDiff(diff: number): DashboardDueInfo["dueTone"] | undefined {
  if (diff <= 0) return "urgent";
  if (diff <= 3) return "urgent";
  if (diff <= 7) return "soon";
  return undefined;
}

export function dueForServiceStartDate(
  startDate: string | null | undefined,
  calendar: KrBusinessDayCalendar,
  today = new Date(),
): DashboardDueInfo | null {
  const diff = businessDayDiff(startDate, calendar, today);
  if (diff === null) return null;

  if (diff < 0) {
    return { due: `서비스 시작 ${Math.abs(diff)} 영업일 경과`, dueTone: "urgent" };
  }
  if (diff === 0) return { due: "서비스 시작 오늘", dueTone: "urgent" };
  return { due: `서비스 시작 ${diff} 영업일 남음`, dueTone: dueToneForBusinessDiff(diff) };
}

export function dueForServiceEndDate(
  endDate: string | null | undefined,
  calendar: KrBusinessDayCalendar,
  today = new Date(),
): DashboardDueInfo | null {
  const diff = businessDayDiff(endDate, calendar, today);
  if (diff === null) return null;

  if (diff < 0) {
    return { due: `서비스 종료 ${Math.abs(diff)} 영업일 경과`, dueTone: "urgent" };
  }
  if (diff === 0) return { due: "서비스 종료 오늘", dueTone: "urgent" };
  return { due: `서비스 종료 ${diff} 영업일 남음`, dueTone: dueToneForBusinessDiff(diff) };
}

function dueForReplacementRequestDate(
  requestedAt: string | null | undefined,
  calendar: KrBusinessDayCalendar,
  today = new Date(),
): DashboardDueInfo | null {
  const diff = businessDayDiff(requestedAt, calendar, today);
  if (diff === null) return null;
  if (diff === 0) return { due: "교체 요청 오늘", dueTone: "urgent" };
  if (diff < 0) return { due: `교체 요청 ${Math.abs(diff)} 영업일 경과`, dueTone: "urgent" };
  return { due: `교체 요청 ${diff} 영업일 남음`, dueTone: "urgent" };
}

export function dueForContractRequired(
  client: Pick<Client, "startDate">,
  calendar: KrBusinessDayCalendar,
  today = new Date(),
): DashboardDueInfo | null {
  return dueForServiceStartDate(client.startDate, calendar, today);
}

export function dueForServiceStatus(
  client: Pick<Client, "serviceStatus" | "startDate" | "endDate" | "updatedAt" | "createdAt">,
  calendar: KrBusinessDayCalendar,
  today = new Date(),
): DashboardDueInfo | null {
  switch (client.serviceStatus) {
    case "waiting":
      return dueForServiceStartDate(client.startDate, calendar, today);
    case "active":
      return dueForServiceEndDate(client.endDate, calendar, today);
    case "completed":
    case "terminated":
      return null;
    case "replacement_requested":
      return dueForReplacementRequestDate(client.updatedAt ?? client.createdAt, calendar, today);
    default:
      return null;
  }
}
