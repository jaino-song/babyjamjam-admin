import { render, screen } from "@testing-library/react";

import { getCurrentUser } from "@/lib/auth/cookies";
import * as posthog from "@/lib/observability/posthog";
import { getSummary } from "@/lib/observability/sentry";
import StatsPage from "./page";
import TrafficDetailPage from "./traffic/page";
import FunnelDetailPage from "./funnel/page";

jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("redirect"); }),
  useRouter: () => ({ refresh: jest.fn() }),
}));
jest.mock("@/lib/auth/cookies", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/observability/posthog", () => ({
  getInquiriesSummary: jest.fn(), getInquiriesDailyTrend: jest.fn(),
  getFunnelSummary: jest.fn(), getTrafficSummary: jest.fn(), getTrafficTrend: jest.fn(),
  getTopPages: jest.fn(), getDeviceBreakdown: jest.fn(), getBrowserBreakdown: jest.fn(),
  getSourceBreakdown: jest.fn(), getRegionBreakdown: jest.fn(),
  getPageNavSummary: jest.fn(), getPagesDetail: jest.fn(), getEntryPages: jest.fn(),
  getExitPages: jest.fn(), getPageTransitions: jest.fn(),
  formatRelativeKo: () => "방금 전", isPostHogConfigured: () => false,
}));
jest.mock("@/lib/observability/sentry", () => ({
  getSummary: jest.fn(), isSentryConfigured: () => false,
  formatSentryRelativeTime: () => "방금 전",
}));

it.each([
  ["overview", StatsPage], ["traffic", TrafficDetailPage], ["funnel", FunnelDetailPage],
] as const)("shows unavailable fallbacks without queries, skeletons or retries on %s", async (_route, Page) => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue({ role: "owner" } as never);
  jest.mocked(getSummary).mockResolvedValue({} as never);

  const { container } = render(await Page({}));

  expect(screen.getByText(/연결이 설정되지 않아/)).toBeInTheDocument();
  expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  expect(screen.getAllByText("PostHog 연결이 필요해요.").length).toBeGreaterThan(0);
  if (_route === "traffic") {
    expect(container.querySelector('[data-component="desktop_stats-traffic_page_device-unavailable"]')).toHaveTextContent("PostHog 연결이 필요해요.");
    expect(screen.queryByText(/Mobile/)).not.toBeInTheDocument();
  }
  expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  expect(screen.queryByText("통계를 불러오지 못했습니다")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /다시 시도/ })).not.toBeInTheDocument();
  for (const [name, query] of Object.entries(posthog)) {
    if (name.startsWith("get")) expect(query).not.toHaveBeenCalled();
  }
});
