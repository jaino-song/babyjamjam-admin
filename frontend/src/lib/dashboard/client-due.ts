import type { Client } from "@/lib/client/types";
import {
  isoDateInKorea,
  KR_BUILTIN_CALENDAR,
  type KrBusinessDayCalendar,
  type ServiceDayPolicy,
} from "@/lib/date/business-days";
import {
  type ClientServiceDayFlags,
  serviceDayPolicyOfClient,
} from "@/lib/date/service-day-policy";

export interface DashboardClientDue {
  label: string;
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

// withServiceDays builds a fresh calendar for any non-default policy, so a
// dashboard listing many clients reuses one per (base calendar, policy).
const SERVICE_CALENDARS = new WeakMap<KrBusinessDayCalendar, Map<string, KrBusinessDayCalendar>>();

export function calendarForServiceDays(
  calendar: KrBusinessDayCalendar,
  policy: ServiceDayPolicy,
): KrBusinessDayCalendar {
  if (!policy.saturday && !policy.sunday && !policy.holiday) return calendar;
  const key = `${policy.saturday ? 1 : 0}${policy.sunday ? 1 : 0}${policy.holiday ? 1 : 0}`;
  let byPolicy = SERVICE_CALENDARS.get(calendar);
  if (!byPolicy) {
    byPolicy = new Map();
    SERVICE_CALENDARS.set(calendar, byPolicy);
  }
  let wrapped = byPolicy.get(key);
  if (!wrapped) {
    wrapped = calendar.withServiceDays(policy);
    byPolicy.set(key, wrapped);
  }
  return wrapped;
}

// Display-only: a branch calendar covers only the years it loaded. For a date
// outside them, retry with the built-in list, and show nothing rather than
// throw when that does not cover the date either.
function withCalendarFallback<T>(
  calendar: KrBusinessDayCalendar,
  compute: (calendar: KrBusinessDayCalendar) => T,
  policy?: ServiceDayPolicy,
): T | null {
  const primary = policy ? calendarForServiceDays(calendar, policy) : calendar;
  try {
    return compute(primary);
  } catch {
    if (calendar === KR_BUILTIN_CALENDAR) return null;
  }
  try {
    return compute(policy ? calendarForServiceDays(KR_BUILTIN_CALENDAR, policy) : KR_BUILTIN_CALENDAR);
  } catch {
    return null;
  }
}

function businessDayDiff(
  targetDate: string | null | undefined,
  today: Date,
  calendar: KrBusinessDayCalendar,
  policy?: ServiceDayPolicy,
) {
  const targetIso = normalizeIsoDate(targetDate);
  if (!targetIso) return null;
  return withCalendarFallback(
    calendar,
    (cal) => cal.diffBusinessDays(targetIso, isoDateInKorea(today)),
    policy,
  );
}

export function isServiceEndingNextBusinessDay(
  client: Pick<Client, "serviceStatus" | "endDate"> & ClientServiceDayFlags,
  today = new Date(),
  calendar: KrBusinessDayCalendar = KR_BUILTIN_CALENDAR,
): boolean {
  if (client.serviceStatus !== "active") {
    return false;
  }

  const policy = serviceDayPolicyOfClient(client);
  const todayIso = isoDateInKorea(today);
  return Boolean(withCalendarFallback(calendar, (cal) => cal.isBusinessDay(todayIso), policy))
    && businessDayDiff(client.endDate, today, calendar, policy) === 1;
}

function formatBusinessDue(prefix: string, diff: number) {
  if (diff < 0) return `${prefix} ${Math.abs(diff)} 영업일 경과`;
  if (diff === 0) return `${prefix} 오늘`;
  return `${prefix} ${diff} 영업일 남음`;
}

export function getServiceStartDueLabel(
  startDate: string | null | undefined,
  today = new Date(),
  calendar: KrBusinessDayCalendar = KR_BUILTIN_CALENDAR,
): string | null {
  const diff = businessDayDiff(startDate, today, calendar);
  return diff === null ? null : formatBusinessDue("서비스 시작", diff);
}

export function getServiceEndDueLabel(
  endDate: string | null | undefined,
  today = new Date(),
  calendar: KrBusinessDayCalendar = KR_BUILTIN_CALENDAR,
  serviceDays?: ServiceDayPolicy,
): string | null {
  const diff = businessDayDiff(endDate, today, calendar, serviceDays);
  return diff === null ? null : formatBusinessDue("서비스 종료", diff);
}

function getReplacementRequestDueLabel(
  requestedAt: string | null | undefined,
  today: Date,
  calendar: KrBusinessDayCalendar,
): string | null {
  const diff = businessDayDiff(requestedAt, today, calendar);
  return diff === null ? null : formatBusinessDue("교체 요청", diff);
}

export function getDashboardClientDueLabel(
  client: Pick<Client, "serviceStatus" | "startDate" | "endDate" | "createdAt"> & ClientServiceDayFlags,
  options: {
    contractRequired?: boolean;
    upcoming?: boolean;
    today?: Date;
    /** Branch calendar; the built-in one while it loads. */
    calendar?: KrBusinessDayCalendar;
  } = {},
): string | null {
  const today = options.today ?? new Date();
  const calendar = options.calendar ?? KR_BUILTIN_CALENDAR;

  if (options.contractRequired || options.upcoming || client.serviceStatus === "waiting") {
    return getServiceStartDueLabel(client.startDate, today, calendar);
  }

  switch (client.serviceStatus) {
    case "active":
      return getServiceEndDueLabel(client.endDate, today, calendar, serviceDayPolicyOfClient(client));
    case "replacement_requested":
      return getReplacementRequestDueLabel(client.createdAt, today, calendar);
    case "completed":
    case "terminated":
      return null;
    default:
      return null;
  }
}
