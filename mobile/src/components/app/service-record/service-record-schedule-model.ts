import type { ServiceRecordOverview } from "@babyjamjam/shared/types/service-record";
import {
  classifyServiceDay,
  setServiceDayPolicy,
  toggleServiceDay,
  type ServiceDayClass,
  type ServiceDayPickerState,
} from "@babyjamjam/shared/utils/service-day-picker";

import {
  UnsupportedKoreanHolidayYearError,
  type KrBusinessDayCalendar,
  type ServiceDayPolicy,
} from "@/lib/date/business-days";

/**
 * The 제공기록지 일정 변경 sheet's rules, without any React: what the editor overview says about
 * the schedule, and the small wrapper around the shared day picker that keeps written sessions fixed.
 *
 * The server compares written sessions by date AND index, so every date on or before the last
 * written session's date is fixed: a selected one cannot be removed and an unselected one cannot be
 * added. Written dates also stay selected when a toggle would exclude their weekday.
 */

export interface ScheduleEditorModel {
  /** Case start (`YYYY-MM-DD`). Nothing earlier can be chosen. */
  startDate: string;
  /** Read-only session count: the number of dates that must end up selected. */
  requiredCount: number;
  /** The stored dates, in session order. */
  initialDates: string[];
  /** Dates of sessions that were submitted or locked, ascending. */
  writtenDates: string[];
  lastWrittenDate: string | null;
  /** The client's stored toggles. */
  serviceDays: ServiceDayPolicy;
}

export type ScheduleEditorModelResult =
  | { ok: true; model: ScheduleEditorModel }
  | { ok: false; reason: "blocked" | "empty" | "no-start" };

type EditorOverview = ServiceRecordOverview & {
  serviceDays?: { saturday: boolean; sunday: boolean; holiday: boolean };
};

export type ScheduleDayClass = ServiceDayClass | "locked" | "fixed-unavailable";

export type ScheduleToggleOutcome = "removed" | "added" | "full" | "not-selectable" | "locked";

export interface ScheduleProgress {
  selectedCount: number;
  requiredCount: number;
  /** Selected dates that are not service days and are not written. */
  invalid: string[];
  complete: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

export function dateOnly(value: unknown): string | null {
  return typeof value === "string" && ISO_DATE.test(value) ? value.slice(0, 10) : null;
}

function sortedUnique(dates: readonly string[]): string[] {
  return [...new Set(dates)].sort();
}

/** A year without holiday data is "not a service day" so a month view never throws. */
export function isServiceDaySafe(calendar: KrBusinessDayCalendar, iso: string): boolean {
  try {
    return calendar.isBusinessDay(iso);
  } catch (error) {
    if (error instanceof UnsupportedKoreanHolidayYearError) return false;
    throw error;
  }
}

/** Reads N, the stored dates, the start date and the written sessions off the editor overview. */
export function readScheduleEditorModel(overview: EditorOverview): ScheduleEditorModelResult {
  const projection = overview.scheduleProjection;
  if (!projection || projection.blockingReasons.length > 0) return { ok: false, reason: "blocked" };
  const entries = [...projection.entries].sort((left, right) => left.sessionIndex - right.sessionIndex);
  if (entries.length === 0) return { ok: false, reason: "empty" };

  const initialDates: string[] = [];
  for (const [position, entry] of entries.entries()) {
    const date = dateOnly(entry.serviceDate);
    if (entry.sessionIndex !== position + 1 || date === null) return { ok: false, reason: "blocked" };
    if (position > 0 && date <= initialDates[position - 1]) return { ok: false, reason: "blocked" };
    initialDates.push(date);
  }

  const record = overview.record ?? null;
  const assignments = overview.assignments ?? [];
  const startDate = dateOnly(record?.startDate ?? assignments[0]?.startDate ?? null);
  if (startDate === null) return { ok: false, reason: "no-start" };

  const writtenIndexes = new Set<number>();
  const writtenFallback = new Map<number, string>();
  const sessions = [...(record?.sessions ?? []), ...assignments.flatMap((assignment) => assignment.sessions ?? [])];
  for (const session of sessions) {
    if (!session.locked && !session.submittedAt) continue;
    if (session.sessionIndex < 1 || session.sessionIndex > entries.length) continue;
    writtenIndexes.add(session.sessionIndex);
    const own = dateOnly(session.serviceDate);
    if (own !== null) writtenFallback.set(session.sessionIndex, own);
  }
  const writtenDates = sortedUnique(
    [...writtenIndexes].flatMap((index) => {
      const date = initialDates[index - 1] ?? writtenFallback.get(index);
      return date === undefined ? [] : [date];
    }),
  );

  return {
    ok: true,
    model: {
      startDate,
      requiredCount: entries.length,
      initialDates,
      writtenDates,
      lastWrittenDate: writtenDates.length > 0 ? writtenDates[writtenDates.length - 1] : null,
      serviceDays: {
        saturday: overview.serviceDays?.saturday ?? false,
        sunday: overview.serviceDays?.sunday ?? false,
        holiday: overview.serviceDays?.holiday ?? false,
      },
    },
  };
}

/** The calendar years the sheet needs: from the start through the last stored date, plus one. */
export function scheduleCalendarYears(model: ScheduleEditorModel): number[] {
  const years = [model.startDate, ...model.initialDates].map((date) => Number(date.slice(0, 4)));
  const first = Math.min(...years);
  const last = Math.max(...years) + 1;
  const result: number[] = [];
  for (let year = first; year <= last; year += 1) result.push(year);
  return result;
}

function isFixedDate(model: ScheduleEditorModel, iso: string): boolean {
  return iso >= model.startDate && model.lastWrittenDate !== null && iso <= model.lastWrittenDate;
}

/** `calendar` must already carry the picker's policy (`base.withServiceDays(picker.policy)`). */
export function classifyScheduleDay(
  model: ScheduleEditorModel,
  picker: ServiceDayPickerState,
  iso: string,
  calendar: KrBusinessDayCalendar,
): ScheduleDayClass {
  if (isFixedDate(model, iso)) return picker.selected.includes(iso) ? "locked" : "fixed-unavailable";
  return classifyServiceDay(picker, iso, calendar);
}

export function toggleScheduleDay(
  model: ScheduleEditorModel,
  picker: ServiceDayPickerState,
  iso: string,
  calendar: KrBusinessDayCalendar,
): { state: ServiceDayPickerState; outcome: ScheduleToggleOutcome } {
  if (isFixedDate(model, iso)) {
    return { state: picker, outcome: picker.selected.includes(iso) ? "locked" : "not-selectable" };
  }
  return toggleServiceDay(picker, iso, calendar);
}

/**
 * Applies a toggle change. Written dates the new policy would drop are put back (the server accepts
 * unchanged locked dates); `dropped` lists only the dates that were really removed.
 */
export function changeSchedulePolicy(
  model: ScheduleEditorModel,
  picker: ServiceDayPickerState,
  policy: ServiceDayPolicy,
  baseCalendar: KrBusinessDayCalendar,
): { state: ServiceDayPickerState; dropped: string[] } {
  const written = new Set(model.writtenDates);
  const { state, dropped } = setServiceDayPolicy(picker, policy, baseCalendar);
  const restored = dropped.filter((iso) => written.has(iso));
  return {
    state: restored.length > 0 ? { ...state, selected: sortedUnique([...state.selected, ...restored]) } : state,
    dropped: dropped.filter((iso) => !written.has(iso)),
  };
}

/**
 * `selectedCount === N` with no invalid date. Written dates never count as invalid, and the fixed
 * dates must all still be selected (a toggle may have dropped an unwritten one among them, which can
 * no longer be refilled). `calendar` must carry the picker's policy.
 */
export function scheduleProgress(
  model: ScheduleEditorModel,
  picker: ServiceDayPickerState,
  calendar: KrBusinessDayCalendar,
): ScheduleProgress {
  const written = new Set(model.writtenDates);
  const invalid = picker.selected.filter((iso) => !written.has(iso) && !isServiceDaySafe(calendar, iso));
  const selectedCount = picker.selected.length;
  const prefixIntact = model.initialDates
    .filter((iso) => isFixedDate(model, iso))
    .every((iso) => picker.selected.includes(iso));
  return {
    selectedCount,
    requiredCount: picker.requiredCount,
    invalid,
    complete: selectedCount === picker.requiredCount && invalid.length === 0 && prefixIntact,
  };
}

/** `[year, monthIndex]` of the first selected unwritten date, else of the start date. */
export function initialScheduleMonth(model: ScheduleEditorModel, picker: ServiceDayPickerState): [number, number] {
  const written = new Set(model.writtenDates);
  const anchor = picker.selected.find((iso) => !written.has(iso)) ?? model.startDate;
  return [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)) - 1];
}

export function monthKey([year, month]: readonly [number, number]): number {
  return year * 12 + month;
}

export function shiftMonth([year, month]: readonly [number, number], delta: number): [number, number] {
  const total = year * 12 + month + delta;
  return [Math.floor(total / 12), ((total % 12) + 12) % 12];
}

export function isoFromParts(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Leading blank cells (Sunday-first week) and the ISO dates of the month. */
export function buildMonthGrid(year: number, monthIndex: number): { leadingBlanks: number; dates: string[] } {
  const leadingBlanks = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) dates.push(isoFromParts(year, monthIndex, day));
  return { leadingBlanks, dates };
}

export function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}
