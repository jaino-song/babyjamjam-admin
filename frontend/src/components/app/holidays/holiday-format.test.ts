import {
  describeSyncResult,
  formatHolidayDate,
  formatLastSynced,
  isValidIsoDate,
  isWeekend,
} from "./holiday-format";

describe("holiday-format", () => {
  it("formats a date as M월 D일 (요일)", () => {
    expect(formatHolidayDate("2026-10-05")).toBe("10월 5일 (월)");
    expect(formatHolidayDate("2026-10-03")).toBe("10월 3일 (토)");
    expect(formatHolidayDate("2027-01-01")).toBe("1월 1일 (금)");
  });

  it("formats the sync timestamp in Korea time", () => {
    expect(formatLastSynced("2026-09-30T19:00:00.000Z")).toBe("10월 1일 04:00");
    expect(formatLastSynced("2026-12-31T15:30:00.000Z")).toBe("1월 1일 00:30");
    expect(formatLastSynced("not a date")).toBe("");
  });

  it("validates real calendar dates only", () => {
    expect(isValidIsoDate("2026-10-01")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-1-1")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });

  it("detects weekends", () => {
    expect(isWeekend("2026-10-03")).toBe(true);
    expect(isWeekend("2026-10-04")).toBe(true);
    expect(isWeekend("2026-10-05")).toBe(false);
  });

  it("describes every sync outcome", () => {
    expect(describeSyncResult({ year: 2026, status: "unchanged", added: 0, removed: 0 })).toBe("2026년 변경 없음");
    expect(describeSyncResult({ year: 2027, status: "updated", added: 1, removed: 0 })).toBe("2027년 1건 추가");
    expect(describeSyncResult({ year: 2027, status: "updated", added: 0, removed: 3 })).toBe("2027년 3건 삭제");
    expect(describeSyncResult({ year: 2027, status: "updated", added: 2, removed: 1 })).toBe("2027년 2건 추가 · 1건 삭제");
    expect(describeSyncResult({ year: 2027, status: "updated", added: 0, removed: 0 })).toBe("2027년 이름 변경 반영");
    expect(describeSyncResult({ year: 2027, status: "failed", added: 0, removed: 0 })).toBe(
      "2027년 공휴일 정보를 가져오지 못했어요",
    );
  });
});
