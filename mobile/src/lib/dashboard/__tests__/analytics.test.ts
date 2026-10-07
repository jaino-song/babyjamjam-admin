import {
  deriveDashboardAnalyticsFromClients,
  formatAnalyticsCount,
  isServiceStartingWithinWeek,
  normalizeDashboardAnalyticsPayload,
  type DashboardAnalyticsClient,
} from "@/lib/dashboard/analytics";

const NOW = new Date("2026-06-10T12:00:00+09:00");

function client(overrides: Partial<DashboardAnalyticsClient> = {}): DashboardAnalyticsClient {
  return {
    serviceStatus: "waiting",
    startDate: "2026-06-10T00:00:00+09:00",
    eDocId: null,
    documentStatus: null,
    ...overrides,
  };
}

describe("isServiceStartingWithinWeek", () => {
  it("counts service starts from today through seven days later", () => {
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-10T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-17T23:59:00+09:00" }),
        NOW,
      ),
    ).toBe(true);
  });

  it("includes planned pre-booking starts in the upcoming window", () => {
    expect(
      isServiceStartingWithinWeek(
        client({
          serviceStatus: "pre_booking",
          startDate: "2026-06-12T00:00:00+09:00",
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("excludes past starts, dates outside the window, completed services, and ended services", () => {
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-09T23:59:00+09:00" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-10T00:00:00+09:00", serviceStatus: "terminated" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isServiceStartingWithinWeek(
        client({ startDate: "2026-06-10T00:00:00+09:00", serviceStatus: "completed" }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("deriveDashboardAnalyticsFromClients", () => {
  it("leaves the server-decided contract counts unknown instead of guessing them from the client rows", () => {
    const analytics = deriveDashboardAnalyticsFromClients(
      [
        // Would have been counted by the old local "incomplete near start" rule.
        client({ startDate: "2026-06-03T00:00:00+09:00" }),
        client({ startDate: "2026-06-17T23:59:00+09:00", eDocId: "doc-1", documentStatus: "opened" }),
      ],
      NOW,
    );

    expect(analytics.contractsNotSent).toBeNull();
    expect(analytics.contractsPendingSignature).toBeNull();
    expect(analytics.upcomingThisMonth).toBeNull();
  });

  it("derives weekly upcoming starts from the same rule the dashboard list uses", () => {
    const analytics = deriveDashboardAnalyticsFromClients(
      [
        client({ startDate: "2026-06-09T23:59:00+09:00" }),
        client({ startDate: "2026-06-10T00:00:00+09:00" }),
        client({ startDate: "2026-06-17T23:59:00+09:00" }),
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        client({ startDate: "2026-06-12T00:00:00+09:00", serviceStatus: "pre_booking" }),
        client({ startDate: "2026-06-12T00:00:00+09:00", serviceStatus: "completed" }),
      ],
      NOW,
    );

    expect(analytics.upcomingWithinWeek).toBe(3);
  });

  it("counts active clients", () => {
    const analytics = deriveDashboardAnalyticsFromClients(
      [client({ serviceStatus: "active" }), client({ serviceStatus: "active" }), client()],
      NOW,
    );

    expect(analytics.activeClients).toBe(2);
  });
});

describe("normalizeDashboardAnalyticsPayload", () => {
  it("keeps a missing count unknown (null) instead of turning it into zero", () => {
    expect(
      normalizeDashboardAnalyticsPayload({ activeClients: 3, contractsNotSent: 2 }),
    ).toEqual({
      activeClients: 3,
      contractsNotSent: 2,
      contractsPendingSignature: null,
      upcomingThisMonth: null,
      upcomingNextMonth: null,
      upcomingWithinWeek: null,
    });
  });

  it("returns null when the payload carries no usable count", () => {
    expect(normalizeDashboardAnalyticsPayload({})).toBeNull();
    expect(normalizeDashboardAnalyticsPayload(null)).toBeNull();
  });

  it("reads an explicit zero as a real zero", () => {
    expect(normalizeDashboardAnalyticsPayload({ contractsNotSent: 0 })?.contractsNotSent).toBe(0);
  });
});

describe("formatAnalyticsCount", () => {
  it("renders zero as 0 and unknown as a dash", () => {
    expect(formatAnalyticsCount(0)).toBe("0");
    expect(formatAnalyticsCount(7)).toBe("7");
    expect(formatAnalyticsCount(null)).toBe("-");
    expect(formatAnalyticsCount(undefined)).toBe("-");
  });
});

describe("KST anchoring (server-timezone independence)", () => {
  // 2026-06-05T20:00:00Z = 2026-06-06 05:00 KST. The KST window for "within a week" is
  // [2026-06-06 00:00 KST, 2026-06-13 23:59:59.999 KST]. A server-local UTC-anchored
  // window would start/end 9 hours later — these cases fail under local-TZ day math
  // on a UTC runner.
  const utcEveningNow = new Date("2026-06-05T20:00:00Z");

  it("opens the weekly window at KST midnight, not UTC midnight", () => {
    // 2026-06-05T10:00:00Z = 2026-06-05 19:00 KST: yesterday in KST, but already "today" under UTC.
    expect(
      isServiceStartingWithinWeek(client({ startDate: "2026-06-05T10:00:00Z" }), utcEveningNow),
    ).toBe(false);
    // 2026-06-05T16:00:00Z = 2026-06-06 01:00 KST: today in KST.
    expect(
      isServiceStartingWithinWeek(client({ startDate: "2026-06-05T16:00:00Z" }), utcEveningNow),
    ).toBe(true);
  });

  it("closes the weekly window at KST end-of-day, not UTC end-of-day", () => {
    expect(
      isServiceStartingWithinWeek(client({ startDate: "2026-06-13T18:00:00Z" }), utcEveningNow),
    ).toBe(false);
  });

  it("buckets next-month starts by KST calendar month", () => {
    // 2026-06-30T16:00:00Z = 2026-07-01 01:00 KST: next month in KST,
    // still June under UTC bucketing.
    const analytics = deriveDashboardAnalyticsFromClients(
      [client({ startDate: "2026-06-30T16:00:00Z" })],
      utcEveningNow,
    );

    expect(analytics.upcomingNextMonth).toBe(1);
  });
});
