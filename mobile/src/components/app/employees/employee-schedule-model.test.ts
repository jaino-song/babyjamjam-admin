import type { Client } from "@/lib/client/types";

import {
  buildMonthCalendarDays,
  buildScheduleEntries,
  getScheduleMonthRange,
  parseScheduleDate,
} from "./employee-schedule-model";

function makeClient(overrides: Partial<Client>): Client {
  return {
    id: 1,
    name: "박서연",
    birthday: null,
    dueDate: null,
    birthDate: null,
    address: null,
    phone: null,
    primaryEmployee: { id: 7, name: "김하늘" },
    secondaryEmployee: null,
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    serviceStatus: "active",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  };
}

describe("employee schedule model", () => {
  const now = new Date("2026-09-16T09:00:00+09:00");

  it("includes Jan 1, 2026 and the exact inclusive same date next year", () => {
    const entries = buildScheduleEntries([
      makeClient({ id: 7, startDate: "2026-01-01" }),
      makeClient({ id: 8, startDate: "2027-09-16" }),
      makeClient({ id: 9, startDate: "2027-09-17" }),
    ], now);

    expect(entries.map((entry) => entry.dateKey)).toEqual(["2026-01-01", "2027-09-16"]);
  });

  it("clamps a leap day to February 28 in the next non-leap year", () => {
    const range = getScheduleMonthRange(new Date(2028, 1, 29));
    expect(range.horizonEnd.getFullYear()).toBe(2029);
    expect(range.horizonEnd.getMonth()).toBe(1);
    expect(range.horizonEnd.getDate()).toBe(28);
  });

  it("rejects malformed dates and excludes terminated starts", () => {
    expect(parseScheduleDate("2027-02-31")).toBeNull();
    expect(parseScheduleDate("2027-02-31T09:00:00+09:00")).toBeNull();
    expect(parseScheduleDate("not-a-date")).toBeNull();
    expect(buildScheduleEntries([
      makeClient({ id: 2, startDate: "2027-02-31" }),
      makeClient({ id: 3, serviceStatus: "terminated", startDate: "2026-09-18" }),
    ], now)).toEqual([]);
  });

  it("maps replacement requests and only active clients to status events", () => {
    const entries = buildScheduleEntries([
      makeClient({ id: 4, serviceStatus: "replacement_requested" }),
      makeClient({ id: 5, serviceStatus: "active", endDate: "2026-09-20" }),
      makeClient({ id: 6, serviceStatus: "completed", endDate: "2026-09-20" }),
    ], now);

    expect(entries.map((entry) => entry.kind)).toEqual(["replacement", "end"]);
    expect(entries[0]).toEqual(expect.objectContaining({ dateKey: "2026-09-16", title: "박서연 교체 요청" }));
  });

  it("sorts same-day events by stable event id", () => {
    const entries = buildScheduleEntries([
      makeClient({ id: 3, startDate: "2026-09-18", endDate: "2026-09-18" }),
      makeClient({ id: 2, startDate: "2026-09-18" }),
    ], now);

    expect(entries.map((entry) => entry.id)).toEqual(["2-start", "3-end", "3-start"]);
  });

  it("aligns calendar grids to Sunday and marks horizon boundaries", () => {
    const range = getScheduleMonthRange(new Date(2026, 8, 17));
    const days = buildMonthCalendarDays(new Date(2026, 0, 1), range.horizonStart, range.horizonEnd);

    expect(days[0]?.dateKey).toBe("2025-12-28");
    expect(days.find((day) => day.dateKey === "2025-12-31")?.isInHorizon).toBe(false);
    expect(days.find((day) => day.dateKey === "2026-01-01")?.isInHorizon).toBe(true);
  });
});
