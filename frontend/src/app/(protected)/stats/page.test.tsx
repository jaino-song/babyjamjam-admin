import { render } from "@testing-library/react";

import { getCurrentUser } from "@/lib/auth/cookies";
import {
  getDeviceBreakdown,
  getFunnelSummary,
  getInquiriesDailyTrend,
  getInquiriesSummary,
  getTopPages,
  getTrafficSummary,
  isPostHogConfigured,
} from "@/lib/observability/posthog";
import {
  getSummary as getSentrySummary,
  isSentryConfigured,
} from "@/lib/observability/sentry";
import StatsPage from "./page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));

jest.mock("@/lib/auth/cookies", () => ({
  getCurrentUser: jest.fn(),
}));

jest.mock("@/lib/observability/posthog", () => ({
  getDeviceBreakdown: jest.fn(),
  getFunnelSummary: jest.fn(),
  getInquiriesDailyTrend: jest.fn(),
  getInquiriesSummary: jest.fn(),
  getTopPages: jest.fn(),
  getTrafficSummary: jest.fn(),
  formatRelativeKo: jest.fn(() => "방금 전"),
  isPostHogConfigured: jest.fn(),
}));

jest.mock("@/lib/observability/sentry", () => ({
  formatSentryRelativeTime: jest.fn(() => "방금 전"),
  getSummary: jest.fn(),
  isSentryConfigured: jest.fn(),
}));

const mockedGetCurrentUser = jest.mocked(getCurrentUser);
const mockedGetDeviceBreakdown = jest.mocked(getDeviceBreakdown);
const mockedGetFunnelSummary = jest.mocked(getFunnelSummary);
const mockedGetInquiriesDailyTrend = jest.mocked(getInquiriesDailyTrend);
const mockedGetInquiriesSummary = jest.mocked(getInquiriesSummary);
const mockedGetTopPages = jest.mocked(getTopPages);
const mockedGetTrafficSummary = jest.mocked(getTrafficSummary);
const mockedIsPostHogConfigured = jest.mocked(isPostHogConfigured);
const mockedGetSentrySummary = jest.mocked(getSentrySummary);
const mockedIsSentryConfigured = jest.mocked(isSentryConfigured);

function trafficFixture(overrides: {
  todayPv: number;
  selectedPv: number;
  selectedAvgSessionSeconds: number;
}) {
  return {
    today: { pv: overrides.todayPv, unique: overrides.todayPv },
    yesterday: { pv: 0, unique: 0 },
    sevenDayTotal: { pv: 2, unique: 2 },
    avgSessionSeconds: 999,
    bounceRate: 10,
    selectedRange: {
      days: 30 as const,
      total: { pv: overrides.selectedPv, unique: overrides.selectedPv },
      avgSessionSeconds: overrides.selectedAvgSessionSeconds,
      bounceRate: 20,
    },
  };
}

function configurePage(traffic: ReturnType<typeof trafficFixture>) {
  mockedGetCurrentUser.mockResolvedValue({ role: "owner" } as never);
  mockedIsPostHogConfigured.mockReturnValue(true);
  mockedIsSentryConfigured.mockReturnValue(true);
  mockedGetSentrySummary.mockResolvedValue({
    openCount: 0,
    newIn24h: 0,
    severity: { critical: 0, error: 0, warning: 0, info: 0 },
    topIssue: null,
    totalEvents7d: 0,
    affectedUsers: 0,
    lastErrorAt: null,
    sparkline7d: [],
    selectedRange: { days: 30, totalEvents: 0, affectedUsers: 0, sparkline: [] },
  });
  mockedGetInquiriesSummary.mockResolvedValue({
    today: 0,
    yesterday: 0,
    sevenDayTotal: 0,
    sevenDayAvg: 0,
    thirtyDayTotal: 0,
    lastSubmissionAt: null,
    conversionRate: 0,
    selectedRange: { days: 30, total: 0, average: 0, conversionRate: 0 },
  });
  mockedGetInquiriesDailyTrend.mockResolvedValue([]);
  mockedGetFunnelSummary.mockResolvedValue({
    steps: [],
    conversionRate: 0,
    biggestDropStep: null,
    completedConversions: 0,
    totalEntries: 0,
  });
  mockedGetTrafficSummary.mockResolvedValue(traffic);
  mockedGetTopPages.mockResolvedValue([]);
  mockedGetDeviceBreakdown.mockResolvedValue([]);
}

describe("StatsPage selected traffic range", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the selected-period average session instead of the legacy today value", async () => {
    configurePage(trafficFixture({ todayPv: 0, selectedPv: 6, selectedAvgSessionSeconds: 125 }));
    const page = await StatsPage({ searchParams: Promise.resolve({ period: "30" }) });

    const { container } = render(page);
    const trafficPanel = container.querySelector<HTMLElement>(
      '[data-component="desktop_stats_page_grid_inner_panel-traffic"]',
    );
    expect(trafficPanel).toBeInTheDocument();
    const trafficSession = trafficPanel!.querySelector<HTMLElement>(
      '[data-component="desktop_stats_page_grid_inner_panel-traffic-session"]',
    );
    expect(trafficSession).toBeInTheDocument();
    expect(trafficSession).toHaveTextContent("2:05");

    expect(trafficSession).not.toHaveTextContent("16:39");
  });

  it("shows an unavailable average when the selected range has no traffic", async () => {
    configurePage(trafficFixture({ todayPv: 9, selectedPv: 0, selectedAvgSessionSeconds: 125 }));
    const page = await StatsPage({ searchParams: Promise.resolve({ period: "30" }) });

    const { container } = render(page);
    const trafficPanel = container.querySelector<HTMLElement>(
      '[data-component="desktop_stats_page_grid_inner_panel-traffic"]',
    );
    expect(trafficPanel).toBeInTheDocument();
    const trafficSession = trafficPanel!.querySelector<HTMLElement>(
      '[data-component="desktop_stats_page_grid_inner_panel-traffic-session"]',
    );
    expect(trafficSession).toBeInTheDocument();
    expect(trafficSession).toHaveTextContent("—");

    expect(trafficSession).not.toHaveTextContent("2:05");
  });
});
