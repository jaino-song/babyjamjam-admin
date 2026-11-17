import { render, screen } from "@testing-library/react";

import { getCurrentUser } from "@/lib/auth/cookies";
import * as posthog from "@/lib/observability/posthog";
import { getSummary as getSentrySummary } from "@/lib/observability/sentry";
import StatsPage from "./page";
import TrafficDetailPage from "./traffic/page";
import FunnelDetailPage from "./funnel/page";
import InquiriesDetailPage from "./inquiries/page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("redirect"); }),
  useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock("@/lib/auth/cookies", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/observability/posthog", () => ({
  getInquiriesSummary: jest.fn(), getInquiriesDailyTrend: jest.fn(),
  getInquiriesHourlyToday: jest.fn(), getRecentInquiries: jest.fn(), getInquiriesByBranch: jest.fn(),
  getFunnelSummary: jest.fn(), getTrafficSummary: jest.fn(), getTrafficTrend: jest.fn(),
  getTopPages: jest.fn(), getDeviceBreakdown: jest.fn(), getBrowserBreakdown: jest.fn(),
  getSourceBreakdown: jest.fn(), getRegionBreakdown: jest.fn(),
  getPageNavSummary: jest.fn(), getPagesDetail: jest.fn(), getEntryPages: jest.fn(),
  getExitPages: jest.fn(), getPageTransitions: jest.fn(),
  formatRelativeKo: () => "방금 전", isPostHogConfigured: () => true,
}));
jest.mock("@/lib/observability/sentry", () => ({
  getSummary: jest.fn(), isSentryConfigured: () => true,
  formatSentryRelativeTime: () => "방금 전",
}));

const trafficQueries = [
  posthog.getTrafficSummary, posthog.getTrafficTrend, posthog.getTopPages,
  posthog.getDeviceBreakdown, posthog.getBrowserBreakdown,
  posthog.getSourceBreakdown, posthog.getRegionBreakdown,
];
const funnelQueries = [
  posthog.getPageNavSummary, posthog.getPagesDetail, posthog.getEntryPages,
  posthog.getExitPages, posthog.getPageTransitions, posthog.getFunnelSummary,
];
const overviewQueries = [
  posthog.getInquiriesSummary, posthog.getInquiriesDailyTrend, posthog.getFunnelSummary,
  posthog.getTrafficSummary, posthog.getTopPages, posthog.getDeviceBreakdown,
];
const skeletons = (container: HTMLElement) => container.querySelectorAll('[data-slot="skeleton"]');

function setup() {
  jest.mocked(getCurrentUser).mockResolvedValue({ role: "owner" } as never);
  jest.mocked(getSentrySummary).mockResolvedValue({
    openCount: 17, newIn24h: 0, severity: { critical: 0, error: 0, warning: 0, info: 0 },
    topIssue: null, totalEvents7d: 0, affectedUsers: 0, lastErrorAt: null, sparkline7d: [],
    selectedRange: { days: 7, totalEvents: 0, affectedUsers: 0, sparkline: [] },
  });
  jest.mocked(posthog.getInquiriesSummary).mockResolvedValue({
    today: 12, yesterday: 3, sevenDayTotal: 42, sevenDayAvg: 6, thirtyDayTotal: 42,
    lastSubmissionAt: null, conversionRate: 25,
    selectedRange: { days: 7, total: 42, average: 6, conversionRate: 25 },
  });
  jest.mocked(posthog.getTrafficSummary).mockResolvedValue({
    today: { pv: 123, unique: 45 }, yesterday: { pv: 100, unique: 40 },
    sevenDayTotal: { pv: 456, unique: 100 }, avgSessionSeconds: 60, bounceRate: 20,
    selectedRange: { days: 7, total: { pv: 456, unique: 100 }, avgSessionSeconds: 60, bounceRate: 20 },
  });
  jest.mocked(posthog.getPageNavSummary).mockResolvedValue({
    activePages: 2, totalPv: 456, avgPvPerPage: 228, avgBouncePct: 20,
  });
  jest.mocked(posthog.getFunnelSummary).mockResolvedValue({
    steps: [], conversionRate: 0, biggestDropStep: null, completedConversions: 0, totalEntries: 0,
  });
  jest.mocked(posthog.getInquiriesDailyTrend).mockResolvedValue([]);
  jest.mocked(posthog.getInquiriesHourlyToday).mockResolvedValue([]);
  jest.mocked(posthog.getRecentInquiries).mockResolvedValue([]);
  jest.mocked(posthog.getInquiriesByBranch).mockResolvedValue([]);
  jest.mocked(posthog.getTrafficTrend).mockResolvedValue([
    { day: new Date().toISOString().slice(0, 10), pv: 123, unique: 45 },
  ]);
  jest.mocked(posthog.getTopPages).mockResolvedValue([{ path: "/QA-prices", pv: 100, unique: 40, avgTimeSeconds: 30 }]);
  jest.mocked(posthog.getDeviceBreakdown).mockResolvedValue([{ deviceType: "Mobile", count: 80, pct: 80 }]);
  jest.mocked(posthog.getBrowserBreakdown).mockResolvedValue([{ browser: "QA-browser", count: 50, pct: 50 }]);
  jest.mocked(posthog.getSourceBreakdown).mockResolvedValue([]);
  jest.mocked(posthog.getRegionBreakdown).mockResolvedValue([]);
  jest.mocked(posthog.getPagesDetail).mockResolvedValue([]);
  jest.mocked(posthog.getEntryPages).mockResolvedValue([]);
  jest.mocked(posthog.getExitPages).mockResolvedValue([]);
  jest.mocked(posthog.getPageTransitions).mockResolvedValue([]);
}

describe("PostHog failures across statistics routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setup();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["overview", StatsPage, posthog.getTrafficSummary, "desktop_stats_page_hero"],
    ["traffic", TrafficDetailPage, posthog.getTrafficSummary, "desktop_stats-traffic_page_hero"],
    ["funnel", FunnelDetailPage, posthog.getPageNavSummary, "desktop_stats-funnel_page_hero"],
    ["inquiries", InquiriesDetailPage, posthog.getInquiriesSummary, "desktop_stats-inquiries_page_hero"],
  ] as const)("places the %s error directly between the hero and period selector", async (_name, Page, query, hero) => {
    jest.mocked(query).mockRejectedValue(new Error("failed"));
    render(await Page({}));

    const error = screen.getByRole("alert");
    expect(error).toHaveAttribute("data-size", "inline");
    expect(error.previousElementSibling).toHaveAttribute("data-component", hero);
    expect(error.nextElementSibling).toBe(screen.getByLabelText("통계 기간 선택"));
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
  });

  it.each([
    ["overview", StatsPage, overviewQueries],
    ["traffic", TrafficDetailPage, trafficQueries],
    ["funnel", FunnelDetailPage, funnelQueries],
  ] as const)("keeps the %s layout when every PostHog query rejects", async (_name, Page, queries) => {
    for (const query of queries) jest.mocked(query).mockRejectedValue(new Error("private provider payload"));
    const { container } = render(await Page({}));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(skeletons(container).length).toBeGreaterThanOrEqual(10);
    expect(console.error).toHaveBeenCalledTimes(queries.length);
    expect(console.error).toHaveBeenCalledWith("PostHog statistics are unavailable");
    expect(container).not.toHaveTextContent("private provider payload");
  });

  it("preserves Sentry values while the overview PostHog batch fails", async () => {
    for (const query of overviewQueries) jest.mocked(query).mockRejectedValue(new Error("failed"));
    render(await StatsPage({}));
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(getSentrySummary).toHaveBeenCalledWith({ statsPeriod: "7d" });
  });

  it("keeps the traffic chart and top pages when the independent summary fails", async () => {
    jest.mocked(posthog.getTrafficSummary).mockRejectedValue(new Error("failed"));
    const { container } = render(await TrafficDetailPage({}));
    expect(screen.getByText("/QA-prices")).toBeInTheDocument();
    expect(container.querySelector('svg[viewBox="0 0 1100 200"]')).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "100" })).toBeInTheDocument();
    expect(skeletons(container)).toHaveLength(6); // Five KPI values and the missing share denominator.
  });

  it("keeps browsers visible when only devices fail", async () => {
    jest.mocked(posthog.getDeviceBreakdown).mockRejectedValue(new Error("failed"));
    const { container } = render(await TrafficDetailPage({}));
    expect(screen.getByText("QA-browser")).toBeInTheDocument();
    expect(skeletons(container)).toHaveLength(1);
  });

  it("keeps device values visible when only browsers fail", async () => {
    jest.mocked(posthog.getBrowserBreakdown).mockRejectedValue(new Error("failed"));
    const { container } = render(await TrafficDetailPage({}));
    expect(screen.getByText(/80% · 80/)).toBeInTheDocument();
    expect(skeletons(container)).toHaveLength(1);
  });

  it.each(trafficQueries.map((query, index) => [index, query] as const))(
    "contains traffic query failure %s without losing the layout", async (_index, query) => {
      jest.mocked(query).mockRejectedValue(new Error("failed"));
      const { container } = render(await TrafficDetailPage({}));
      expect(screen.getByRole("heading", { name: "사이트 트래픽" })).toBeInTheDocument();
      expect(skeletons(container).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    },
  );

  it.each(funnelQueries.map((query, index) => [index, query] as const))(
    "contains funnel query failure %s and preserves healthy sections", async (_index, query) => {
      jest.mocked(query).mockRejectedValue(new Error("failed"));
      const { container } = render(await FunnelDetailPage({}));
      expect(screen.getByRole("heading", { level: 1, name: "페이지 이동 통계" })).toBeInTheDocument();
      expect(skeletons(container).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    },
  );

  it.each(overviewQueries.map((query, index) => [index, query] as const))(
    "contains overview query failure %s and preserves Sentry", async (_index, query) => {
      jest.mocked(query).mockRejectedValue(new Error("failed"));
      const { container } = render(await StatsPage({}));
      expect(screen.getByText("17")).toBeInTheDocument();
      expect(skeletons(container).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    },
  );

  it.each([StatsPage, TrafficDetailPage, FunnelDetailPage])("renders successful results without failure placeholders", async (Page) => {
    const { container } = render(await Page({}));
    expect(skeletons(container)).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("keeps successful zero activity as empty data rather than an error", async () => {
    jest.mocked(posthog.getTopPages).mockResolvedValue([]);
    render(await TrafficDetailPage({}));
    expect(screen.getAllByText("데이터 없음").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still propagates unrelated Sentry failures to the existing error boundary", async () => {
    jest.mocked(getSentrySummary).mockRejectedValue(new Error("Sentry failure"));
    await expect(StatsPage({})).rejects.toThrow("Sentry failure");
  });
});
