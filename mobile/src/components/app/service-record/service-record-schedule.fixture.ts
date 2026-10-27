import type { ServiceRecordOverview } from "@babyjamjam/shared/types/service-record";

import { createKrBusinessDayCalendar } from "@/lib/date/business-days";

/**
 * Shared test data for the 제공기록지 일정 변경 sheet: N=10, start 2026-12-14, Saturday / Sunday /
 * holiday off, 12-25 a holiday, sessions 1 and 3 written. Tests only.
 */

export const FIXTURE_START = "2026-12-14";
export const FIXTURE_DATES = [
  "2026-12-14",
  "2026-12-15",
  "2026-12-16",
  "2026-12-17",
  "2026-12-18",
  "2026-12-21",
  "2026-12-22",
  "2026-12-23",
  "2026-12-24",
  "2026-12-28",
];

export const FIXTURE_CALENDAR = createKrBusinessDayCalendar(["2026-12-25", "2027-01-01"], {
  supportedYears: [2026, 2027, 2028],
  version: "fixture",
});

export interface FixtureOverviewOptions {
  dates?: readonly string[];
  writtenIndexes?: readonly number[];
  serviceDays?: { saturday: boolean; sunday: boolean; holiday: boolean };
  blockingReasons?: readonly { readonly code: string; readonly message: string }[];
  startDate?: string | null;
}

export function fixtureOverview(options: FixtureOverviewOptions = {}): ServiceRecordOverview & {
  serviceDays?: { saturday: boolean; sunday: boolean; holiday: boolean };
} {
  const dates = options.dates ?? FIXTURE_DATES;
  const written = new Set(options.writtenIndexes ?? [1, 3]);
  const startDate = options.startDate === undefined ? FIXTURE_START : options.startDate;
  return {
    record: {
      startDate,
      sessions: dates.map((serviceDate, position) => ({
        sessionIndex: position + 1,
        serviceDate,
        locked: written.has(position + 1),
        submittedAt: written.has(position + 1) ? "2026-12-16T01:00:00.000Z" : null,
        updatedAt: "2026-12-16T01:00:00.000Z",
        answers: {},
        etcService: null,
        notes: null,
        paymentConfirmed: false,
        hasMomApproval: false,
      })),
    },
    assignments: [],
    scheduleProjection: {
      entries: dates.map((serviceDate, position) => ({
        sessionIndex: position + 1,
        serviceDate,
        originalDate: serviceDate,
        assignmentId: "assignment-1",
        scheduleId: 1,
        employeeId: 1,
        provenanceVersion: "v1",
      })),
      blockingReasons: options.blockingReasons ?? [],
    },
    ...(options.serviceDays ? { serviceDays: options.serviceDays } : {}),
  } as unknown as ServiceRecordOverview & { serviceDays?: { saturday: boolean; sunday: boolean; holiday: boolean } };
}
