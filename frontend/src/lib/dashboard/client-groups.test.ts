import { getDashboardAttentionItems } from "./client-groups";

describe("getDashboardAttentionItems", () => {
  it("excludes clients without an action required", () => {
    expect(getDashboardAttentionItems([{ actionRequired: null }, {}])).toEqual([]);
  });

  it("ignores a pending request in a legacy payload without an action required", () => {
    const legacyClient = {
      actionRequired: null,
      pendingScheduleChange: {
        id: "legacy-request",
        sessionIndex: 4,
        fromDate: "2026-08-20",
        toDate: "2026-08-21",
        oldEndDate: "2026-09-01",
        newEndDate: "2026-09-02",
      },
    };

    expect(getDashboardAttentionItems([legacyClient])).toEqual([]);
  });

  it("preserves the backend action reason and sorts by priority", () => {
    const sendRequired = {
      actionRequired: { reason: "발송 필요" as const, priority: 3 as const },
    };
    const signingRequired = {
      actionRequired: { reason: "서명 필요" as const, priority: 2 as const },
    };

    expect(getDashboardAttentionItems([sendRequired, signingRequired])).toEqual([
      { client: signingRequired, reason: "서명 필요", priority: 2 },
      { client: sendRequired, reason: "발송 필요", priority: 3 },
    ]);
  });
});
