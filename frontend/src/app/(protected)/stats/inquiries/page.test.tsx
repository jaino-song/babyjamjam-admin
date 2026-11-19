import { fireEvent, render, screen } from "@testing-library/react";

import { getCurrentUser } from "@/lib/auth/cookies";
import * as posthog from "@/lib/observability/posthog";
import InquiriesDetailPage from "./page";

const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("redirect"); }),
  useRouter: () => ({ refresh: mockRefresh }),
}));
jest.mock("@/lib/auth/cookies", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/observability/posthog", () => ({
  getInquiriesSummary: jest.fn(),
  getInquiriesDailyTrend: jest.fn(),
  getInquiriesHourlyToday: jest.fn(),
  getInquiriesByBranch: jest.fn(),
  getRecentInquiries: jest.fn(),
  formatRelativeKo: () => "방금 전",
  isPostHogConfigured: () => true,
}));

const queries = [
  posthog.getInquiriesSummary, posthog.getInquiriesDailyTrend,
  posthog.getInquiriesHourlyToday, posthog.getRecentInquiries, posthog.getInquiriesByBranch,
];
const summary = {
  today: 12, yesterday: 3, sevenDayTotal: 42, sevenDayAvg: 6, thirtyDayTotal: 42,
  lastSubmissionAt: null, conversionRate: 25,
  selectedRange: { days: 7 as const, total: 42, average: 6, conversionRate: 25 },
};
const skeletons = (container: HTMLElement) => container.querySelectorAll('[data-slot="skeleton"]');

describe("InquiriesDetailPage provider results", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue({ role: "owner" } as never);
    jest.mocked(posthog.getInquiriesSummary).mockResolvedValue(summary);
    jest.mocked(posthog.getInquiriesDailyTrend).mockResolvedValue([]);
    jest.mocked(posthog.getInquiriesHourlyToday).mockResolvedValue([]);
    jest.mocked(posthog.getInquiriesByBranch).mockResolvedValue([]);
    jest.mocked(posthog.getRecentInquiries).mockResolvedValue([]);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it("keeps the normal layout with skeleton values and one inline retry when all queries reject", async () => {
    for (const query of queries) jest.mocked(query).mockRejectedValue(new Error("private provider payload"));
    const { container } = render(await InquiriesDetailPage({}));

    for (const heading of ["상담 신청 통계", "일별 상담 신청 (최근 7일)", "오늘 시간대별", "지점별 분포 (최근 7일)", "최근 상담 신청"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
    expect(skeletons(container).length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(container).not.toHaveTextContent("private provider payload");
    expect(screen.queryByText("지점별 데이터가 아직 없어요.")).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalledTimes(queries.length);
    expect(console.error).toHaveBeenCalledWith("PostHog statistics are unavailable");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders real values when queries resolve", async () => {
    const { container } = render(await InquiriesDetailPage({}));
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("25.0")).toBeInTheDocument();
    expect(screen.getByText("평균 6.0건/일")).toBeInTheDocument();
    expect(skeletons(container)).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(queries.map((query, index) => [index, query] as const))(
    "preserves healthy sections when inquiry query %s fails", async (index, query) => {
      jest.mocked(query).mockRejectedValue(new Error("failed"));
      const { container } = render(await InquiriesDetailPage({}));

      expect(screen.getByRole("heading", { name: "상담 신청 통계" })).toBeInTheDocument();
      expect(skeletons(container)).toHaveLength(index === 0 ? 6 : 1);
      if (index !== 0) expect(screen.getByText("42")).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(console.error).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps branch scope on all staff requests and never queries branch totals", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue({ role: "manager", branchSlug: "dev-qa" } as never);
    jest.mocked(posthog.getRecentInquiries).mockRejectedValue(new Error("failed"));
    render(await InquiriesDetailPage({ searchParams: Promise.resolve({ period: "30" }) }));
    expect(posthog.getInquiriesSummary).toHaveBeenCalledWith("dev-qa", 30);
    expect(posthog.getInquiriesDailyTrend).toHaveBeenCalledWith(30, "dev-qa");
    expect(posthog.getInquiriesHourlyToday).toHaveBeenCalledWith("dev-qa");
    expect(posthog.getRecentInquiries).toHaveBeenCalledWith(10, "dev-qa", 30);
    expect(posthog.getInquiriesByBranch).not.toHaveBeenCalled();
    expect(screen.queryByText(/지점별 분포/)).not.toBeInTheDocument();
  });

  it("still redirects staff without a branch before fetching", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue({ role: "manager" } as never);
    await expect(InquiriesDetailPage({})).rejects.toThrow("redirect");
    for (const query of queries) expect(query).not.toHaveBeenCalled();
  });
});
