import {
  deriveDashboardAnalyticsFromClients,
  isContractIncompleteNearServiceStart,
  isServiceStartingWithinWeek,
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

describe("isContractIncompleteNearServiceStart", () => {
  it("counts incomplete contracts within seven days before or after service start", () => {
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-03T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isContractIncompleteNearServiceStart(
        client({
          startDate: "2026-06-17T23:59:00+09:00",
          eDocId: "doc-1",
          documentStatus: "opened",
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("excludes completed contracts, ended services, and dates outside the window", () => {
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-10T00:00:00+09:00", documentStatus: "completed" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-10T00:00:00+09:00", serviceStatus: "terminated" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isContractIncompleteNearServiceStart(
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        NOW,
      ),
    ).toBe(false);
  });
});

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

  it("excludes past starts, dates outside the window, and ended services", () => {
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
  });
});

describe("deriveDashboardAnalyticsFromClients", () => {
  it("derives contract attention count from service-start window and incomplete status", () => {
    const analytics = deriveDashboardAnalyticsFromClients(
      [
        client({ startDate: "2026-06-03T00:00:00+09:00" }),
        client({
          startDate: "2026-06-17T23:59:00+09:00",
          eDocId: "doc-1",
          documentStatus: "opened",
        }),
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        client({ startDate: "2026-06-10T00:00:00+09:00", documentStatus: "completed" }),
        client({ startDate: "2026-06-10T00:00:00+09:00", serviceStatus: "completed" }),
      ],
      NOW,
    );

    expect(analytics.contractsNotSent).toBe(2);
  });

  it("derives weekly upcoming starts from service-start window", () => {
    const analytics = deriveDashboardAnalyticsFromClients(
      [
        client({ startDate: "2026-06-09T23:59:00+09:00" }),
        client({ startDate: "2026-06-10T00:00:00+09:00" }),
        client({ startDate: "2026-06-17T23:59:00+09:00" }),
        client({ startDate: "2026-06-18T00:00:00+09:00" }),
        client({ startDate: "2026-06-12T00:00:00+09:00", serviceStatus: "completed" }),
      ],
      NOW,
    );

    expect(analytics.upcomingThisMonth).toBe(2);
  });
});
