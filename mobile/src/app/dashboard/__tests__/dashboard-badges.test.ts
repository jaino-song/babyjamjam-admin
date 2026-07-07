import { compactDashboardBadges, type DashboardStatusBadge } from "../dashboard-badges";

describe("compactDashboardBadges", () => {
  it("keeps meaningful badges visible when more than two states overlap", () => {
    const badges: DashboardStatusBadge[] = [
      { label: "계약서 필요", tone: "burgundy", order: 10, due: "서비스 시작 1 영업일 남음" },
      { label: "진행중", tone: "primary", order: 20, due: "서비스 종료 8 영업일 남음" },
      { label: "유축기 대여", tone: "primary", order: 30 },
    ];

    expect(compactDashboardBadges(badges)).toEqual([
      { label: "계약서 필요", tone: "burgundy", order: 10, due: "서비스 시작 1 영업일 남음" },
      { label: "진행중", tone: "primary", order: 20, due: "서비스 종료 8 영업일 남음" },
    ]);
  });

  it("does not synthesize ellipsis as a status badge", () => {
    const badges: DashboardStatusBadge[] = [
      { label: "계약서 필요", tone: "burgundy", order: 10 },
      { label: "진행중", tone: "primary", order: 20 },
      { label: "유축기 대여", tone: "primary", order: 30 },
    ];

    expect(compactDashboardBadges(badges).map((badge) => badge.label)).not.toContain("...");
  });

  it("keeps the first matching badge timing when duplicate client states merge", () => {
    const badges: DashboardStatusBadge[] = [
      { label: "계약서 필요", tone: "burgundy", order: 10, due: "서비스 시작 2 영업일 경과" },
      { label: "진행중", tone: "primary", order: 20, due: "서비스 시작 2 영업일 경과" },
      { label: "계약서 필요", tone: "burgundy", order: 10, due: "서비스 종료 8 영업일 남음" },
      { label: "진행중", tone: "primary", order: 20, due: "서비스 종료 8 영업일 남음" },
    ];

    expect(compactDashboardBadges(badges)[0]).toMatchObject({
      label: "계약서 필요",
      due: "서비스 시작 2 영업일 경과",
    });
  });
});
