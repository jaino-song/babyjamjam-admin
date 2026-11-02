import { createKrBusinessDayCalendar, KR_BUILTIN_CALENDAR, KR_BUILTIN_HOLIDAYS } from "@/lib/date/business-days";
import {
  calendarForServiceDays,
  getDashboardClientDueLabel,
  isServiceEndingNextBusinessDay,
} from "./client-due";

const TODAY = new Date(2026, 6, 7, 12, 0, 0);
const BRANCH_CALENDAR = createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-07-10"], {
  version: "kr-db-test",
  supportedYears: [2025, 2026, 2027],
});

const BASE_CLIENT = {
  serviceStatus: "active",
  startDate: "2026-07-01",
  endDate: "2026-07-16",
  createdAt: "2026-07-05",
} as const;

describe("getDashboardClientDueLabel", () => {
  it("uses service start business days for contract-required items", () => {
    expect(
      getDashboardClientDueLabel(
        { ...BASE_CLIENT, startDate: "2026-07-08" },
        { contractRequired: true, today: TODAY },
      ),
    ).toBe("서비스 시작 1 영업일 남음");

    expect(
      getDashboardClientDueLabel(
        { ...BASE_CLIENT, startDate: "2026-07-06" },
        { contractRequired: true, today: TODAY },
      ),
    ).toBe("서비스 시작 1 영업일 경과");
  });

  it("uses service start business days for waiting or upcoming items", () => {
    expect(
      getDashboardClientDueLabel(
        { ...BASE_CLIENT, serviceStatus: "waiting", startDate: "2026-07-14" },
        { today: TODAY },
      ),
    ).toBe("서비스 시작 5 영업일 남음");

    expect(
      getDashboardClientDueLabel(BASE_CLIENT, { upcoming: true, today: TODAY }),
    ).toBe("서비스 시작 4 영업일 경과");
  });

  it("uses service end business days for active items", () => {
    expect(
      getDashboardClientDueLabel(BASE_CLIENT, { today: TODAY }),
    ).toBe("서비스 종료 7 영업일 남음");

    // The branch closed Fri 07-10, so one fewer business day remains.
    expect(
      getDashboardClientDueLabel(BASE_CLIENT, { today: TODAY, calendar: BRANCH_CALENDAR }),
    ).toBe("서비스 종료 6 영업일 남음");
  });

  it("does not show completed or terminated due labels", () => {
    expect(
      getDashboardClientDueLabel({ ...BASE_CLIENT, serviceStatus: "completed" }, { today: TODAY }),
    ).toBeNull();

    expect(
      getDashboardClientDueLabel({ ...BASE_CLIENT, serviceStatus: "terminated" }, { today: TODAY }),
    ).toBeNull();
  });

  it("uses business days for replacement requests", () => {
    expect(
      getDashboardClientDueLabel(
        { ...BASE_CLIENT, serviceStatus: "replacement_requested" },
        { today: TODAY },
      ),
    ).toBe("교체 요청 2 영업일 경과");
  });
});

describe("isServiceEndingNextBusinessDay", () => {
  it("includes a service ending on the next business day", () => {
    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-07-08" }, TODAY),
    ).toBe(true);
  });

  it("skips a weekend between today and the service end date", () => {
    const friday = new Date(2026, 6, 10, 12, 0, 0);

    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-07-13" }, friday),
    ).toBe(true);
  });

  it("does not treat a holiday as the preceding business day", () => {
    const electionDay = new Date(2026, 5, 3, 12, 0, 0);

    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-06-04" }, electionDay),
    ).toBe(false);
  });

  it("excludes inactive services and invalid, missing, or non-matching end dates", () => {
    expect(
      isServiceEndingNextBusinessDay(
        { serviceStatus: "completed", endDate: "2026-07-08" },
        TODAY,
      ),
    ).toBe(false);
    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: null }, TODAY),
    ).toBe(false);
    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "not-a-date" }, TODAY),
    ).toBe(false);
    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-07-09" }, TODAY),
    ).toBe(false);
  });
});

describe("isServiceEndingNextBusinessDay with a branch calendar", () => {
  it("counts a branch-closed day as skipped", () => {
    const thursday = new Date(2026, 6, 9, 12, 0, 0);
    // Ends Mon 07-13: two business days away with 07-10 open, one with it closed.
    expect(isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-07-13" }, thursday)).toBe(false);
    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-07-13" }, thursday, BRANCH_CALENDAR),
    ).toBe(true);
  });

  it("is false on a day the branch is closed", () => {
    const closedFriday = new Date(2026, 6, 10, 12, 0, 0);
    expect(isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-07-13" }, closedFriday)).toBe(true);
    expect(
      isServiceEndingNextBusinessDay({ ...BASE_CLIENT, endDate: "2026-07-13" }, closedFriday, BRANCH_CALENDAR),
    ).toBe(false);
  });
});

describe("branch calendar years", () => {
  const narrowCalendar = createKrBusinessDayCalendar([], { version: "kr-db-test", supportedYears: [2026] });

  it("falls back to the built-in list for a date outside the branch calendar's years", () => {
    expect(
      getDashboardClientDueLabel(
        { ...BASE_CLIENT, serviceStatus: "waiting", startDate: "2025-07-09" },
        { today: TODAY, calendar: narrowCalendar },
      ),
    ).toBe(
      getDashboardClientDueLabel(
        { ...BASE_CLIENT, serviceStatus: "waiting", startDate: "2025-07-09" },
        { today: TODAY },
      ),
    );
  });

  it("shows nothing instead of throwing when no calendar covers the date", () => {
    expect(
      getDashboardClientDueLabel(
        { ...BASE_CLIENT, serviceStatus: "waiting", startDate: "2019-07-09" },
        { today: TODAY, calendar: narrowCalendar },
      ),
    ).toBeNull();
  });
});

describe("client service days", () => {
  const saturdayClient = { allowSaturdayService: true };
  const friday = new Date(2026, 6, 10, 12, 0, 0);
  const saturday = new Date(2026, 6, 11, 12, 0, 0);

  it("counts Saturday as a service day before the end date for a Saturday-enabled client", () => {
    // Ends Mon 07-13: a plain client is 1 business day away on Fri, a Saturday client 2 service days away.
    const ending = { ...BASE_CLIENT, endDate: "2026-07-13" };
    expect(isServiceEndingNextBusinessDay(ending, friday)).toBe(true);
    expect(isServiceEndingNextBusinessDay({ ...ending, ...saturdayClient }, friday)).toBe(false);
    expect(getDashboardClientDueLabel({ ...ending, ...saturdayClient }, { today: friday })).toBe("서비스 종료 2 영업일 남음");
  });

  it("is ending next service day on a Saturday only for a Saturday-enabled client", () => {
    const ending = { ...BASE_CLIENT, endDate: "2026-07-13" };
    expect(isServiceEndingNextBusinessDay(ending, saturday)).toBe(false);
    expect(isServiceEndingNextBusinessDay({ ...ending, ...saturdayClient }, saturday)).toBe(true);
  });

  it("keeps the default client's labels unchanged", () => {
    expect(getDashboardClientDueLabel(BASE_CLIENT, { today: TODAY })).toBe("서비스 종료 7 영업일 남음");
    expect(
      getDashboardClientDueLabel({ ...BASE_CLIENT, allowSaturdayService: false, allowSundayService: false, allowHolidayService: false }, { today: TODAY }),
    ).toBe("서비스 종료 7 영업일 남음");
  });

  it("leaves replacement-request and waiting labels on the branch calendar", () => {
    expect(
      getDashboardClientDueLabel({ ...BASE_CLIENT, ...saturdayClient, serviceStatus: "replacement_requested" }, { today: TODAY }),
    ).toBe("교체 요청 2 영업일 경과");
    expect(
      getDashboardClientDueLabel({ ...BASE_CLIENT, ...saturdayClient, serviceStatus: "waiting", startDate: "2026-07-14" }, { today: TODAY }),
    ).toBe("서비스 시작 5 영업일 남음");
  });

  it("reuses one wrapped calendar per base calendar and policy", () => {
    const policy = { saturday: true, sunday: false, holiday: false };
    const first = calendarForServiceDays(BRANCH_CALENDAR, policy);
    expect(first).not.toBe(BRANCH_CALENDAR);
    expect(first.isBusinessDay("2026-07-11")).toBe(true);
    expect(calendarForServiceDays(BRANCH_CALENDAR, { ...policy })).toBe(first);
    expect(calendarForServiceDays(KR_BUILTIN_CALENDAR, policy)).not.toBe(first);
    expect(calendarForServiceDays(BRANCH_CALENDAR, { saturday: false, sunday: false, holiday: false })).toBe(BRANCH_CALENDAR);
  });
});
