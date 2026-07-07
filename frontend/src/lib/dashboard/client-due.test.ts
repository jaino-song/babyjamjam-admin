import { getDashboardClientDueLabel } from "./client-due";

const TODAY = new Date(2026, 6, 7, 12, 0, 0);

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
