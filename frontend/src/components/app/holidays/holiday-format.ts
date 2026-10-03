import type { HolidaySyncYearResult } from "@/services/holiday-settings";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

const KST_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 0 (Sunday) – 6 (Saturday) of a YYYY-MM-DD date. */
export function weekdayIndex(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function isWeekend(isoDate: string): boolean {
  const day = weekdayIndex(isoDate);
  return day === 0 || day === 6;
}

/** "10월 1일 (수)". */
export function formatHolidayDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${Number(month)}월 ${Number(day)}일 (${WEEKDAY_LABELS[weekdayIndex(isoDate)]})`;
}

/** "10월 1일 04:00" in Korea time. */
export function formatLastSynced(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";
  const parts = KST_PARTS_FORMATTER.formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("month")}월 ${read("day")}일 ${read("hour")}:${read("minute")}`;
}

/** One line of the "지금 동기화" result for a single year. */
export function describeSyncResult(result: HolidaySyncYearResult): string {
  if (result.status === "failed") return `${result.year}년 공휴일 정보를 가져오지 못했어요`;
  if (result.status === "unchanged") return `${result.year}년 변경 없음`;
  const parts: string[] = [];
  if (result.added > 0) parts.push(`${result.added}건 추가`);
  if (result.removed > 0) parts.push(`${result.removed}건 삭제`);
  return `${result.year}년 ${parts.length > 0 ? parts.join(" · ") : "이름 변경 반영"}`;
}
