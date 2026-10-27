import {
  readScheduleEditError,
  type ScheduleBlockingReason,
} from "@/features/service-records/api/admin-service-record-schedule.api";
import { t, type Locale } from "@/lib/i18n/translations";

const PREFIX = "clients.schedule-sheet";

/** `{name}` placeholders in a text, filled from `values`. */
export function fillText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export function scheduleText(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  return fillText(t(locale, `${PREFIX}.${key}`), values);
}

function knownText(locale: Locale, group: "schedule-code" | "blocking", code: string): string | null {
  const key = `${PREFIX}.${group}.${code}`;
  const text = t(locale, key);
  return text === key ? null : text;
}

/** One line for the reasons a preview/confirm was blocked, e.g. `3회차: 이미 작성된 회차의 날짜는 …`. */
export function describeBlockingReasons(locale: Locale, reasons: readonly ScheduleBlockingReason[]): string {
  const lines: string[] = [];
  for (const reason of reasons) {
    const known = knownText(locale, "blocking", reason.code) ?? scheduleText(locale, "blocked-generic");
    const line = reason.sessionIndex === undefined
      ? known
      : scheduleText(locale, "blocked-session", { order: reason.sessionIndex, reason: known });
    if (!lines.includes(line)) lines.push(line);
  }
  return lines.join("\n");
}

/** A short message for a failed save call: schedule code, then blocking reasons, then status, then generic. */
export function describeScheduleSaveError(locale: Locale, error: unknown): string {
  const info = readScheduleEditError(error);
  if (info.scheduleCode) {
    const known = knownText(locale, "schedule-code", info.scheduleCode);
    if (known) return known;
  }
  if (info.blockingReasons.length > 0) return describeBlockingReasons(locale, info.blockingReasons);
  if (info.status === 403) return scheduleText(locale, "forbidden");
  return scheduleText(locale, "save-failed");
}
