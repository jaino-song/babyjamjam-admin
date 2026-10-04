import { createKrBusinessDayCalendar, getKoreanHolidays, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";
import {
  dueForContractRequired,
  dueForServiceEndDate,
  dueForServiceStartDate,
  dueForServiceStatus,
} from "../dashboard-due";

const TODAY = new Date(2026, 6, 7, 12, 0, 0);

describe("dashboard due labels", () => {
  it("describes contract-required timing by service start", () => {
    expect(dueForContractRequired({ startDate: "2026-07-08" }, KR_BUILTIN_CALENDAR, TODAY)).toMatchObject({
      due: "서비스 시작 1 영업일 남음",
      dueTone: "urgent",
    });

    expect(dueForContractRequired({ startDate: "2026-07-06" }, KR_BUILTIN_CALENDAR, TODAY)).toMatchObject({
      due: "서비스 시작 1 영업일 경과",
      dueTone: "urgent",
    });
  });

  it("describes waiting timing by service start", () => {
    expect(dueForServiceStartDate("2026-07-14", KR_BUILTIN_CALENDAR, TODAY)).toMatchObject({
      due: "서비스 시작 5 영업일 남음",
      dueTone: "soon",
    });
  });

  it("describes active timing by service end business days", () => {
    expect(dueForServiceEndDate("2026-07-16", KR_BUILTIN_CALENDAR, TODAY)).toMatchObject({
      due: "서비스 종료 7 영업일 남음",
      dueTone: "soon",
    });
  });

  it("counts a branch-added holiday as a non-business day", () => {
    // 2026-07-08 is the next business day for the built-in list; the branch closes that day.
    const branchCalendar = createKrBusinessDayCalendar([...getKoreanHolidays(2026), "2026-07-08"], {
      version: "kr-db-test",
      supportedYears: [2026],
    });

    expect(dueForServiceEndDate("2026-07-16", KR_BUILTIN_CALENDAR, TODAY)).toMatchObject({
      due: "서비스 종료 7 영업일 남음",
    });
    expect(dueForServiceEndDate("2026-07-16", branchCalendar, TODAY)).toMatchObject({
      due: "서비스 종료 6 영업일 남음",
    });
  });

  it("shows no due text for a year the calendar does not cover", () => {
    const branchCalendar = createKrBusinessDayCalendar([...getKoreanHolidays(2026)], {
      version: "kr-db-test",
      supportedYears: [2026],
    });

    expect(dueForServiceEndDate("2031-01-02", branchCalendar, TODAY)).toBeNull();
  });

  it("covers the remaining service status keys", () => {
    expect(dueForServiceStatus({
      serviceStatus: "completed",
      startDate: "2026-06-01",
      endDate: "2026-07-06",
      updatedAt: "2026-07-06",
      createdAt: "2026-06-01",
    }, KR_BUILTIN_CALENDAR, TODAY)).toBeNull();

    expect(dueForServiceStatus({
      serviceStatus: "terminated",
      startDate: "2026-06-01",
      endDate: "2026-07-20",
      updatedAt: "2026-07-05",
      createdAt: "2026-06-01",
    }, KR_BUILTIN_CALENDAR, TODAY)).toBeNull();

    expect(dueForServiceStatus({
      serviceStatus: "replacement_requested",
      startDate: "2026-06-01",
      endDate: "2026-07-20",
      updatedAt: "2026-07-05",
      createdAt: "2026-06-01",
    }, KR_BUILTIN_CALENDAR, TODAY)).toMatchObject({ due: "교체 요청 2 영업일 경과" });
  });

  it.each([
    { diff: null, requestedAt: "2025-07-07", expected: null },
    { diff: 0, requestedAt: "2026-07-07", expected: { due: "교체 요청 오늘", dueTone: "urgent" } },
    { diff: 1, requestedAt: "2026-07-08", expected: { due: "교체 요청 1 영업일 남음", dueTone: "urgent" } },
    { diff: -1, requestedAt: "2026-07-06", expected: { due: "교체 요청 1 영업일 경과", dueTone: "urgent" } },
  ])("formats replacement requests with business-day difference $diff", ({ requestedAt, expected }) => {
    const branchCalendar = createKrBusinessDayCalendar([...getKoreanHolidays(2026)], {
      version: "kr-db-test",
      supportedYears: [2026],
    });

    expect(dueForServiceStatus({
      serviceStatus: "replacement_requested",
      startDate: "2026-06-01",
      endDate: "2026-07-20",
      updatedAt: requestedAt,
      createdAt: "2026-06-01",
    }, branchCalendar, TODAY)).toEqual(expected);
  });
});
