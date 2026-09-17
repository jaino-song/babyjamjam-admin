import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import type { StatsViewResponse } from "@/lib/observability/stats-server";

import { StatsPage } from "../StatsPage";

const mockGetStatsView = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockUser: { role: string } | null = { role: "owner" };

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => mockUser,
}));

jest.mock("@/lib/api/stats", () => ({
  getStatsView: (...args: unknown[]) => mockGetStatsView(...args),
}));

jest.mock("../sliding-card", () => ({
  SlidingCard: ({ list, detail, open }: { list: ReactNode; detail: ReactNode; open: boolean }) => (
    <div data-testid="sliding-card">
      {list}
      {open ? detail : null}
    </div>
  ),
}));

const OVERVIEW_RESPONSE: StatsViewResponse<"overview"> = {
  view: "overview",
  availability: { posthog: "ready", sentry: "ready" },
  state: "ready",
  data: {
    errors: null,
    inquiries: null,
    funnel: null,
    traffic: null,
    topPages: null,
    devices: null,
  },
};

function renderPage(role: string, view: "overview" | "inquiries" = "overview") {
  mockUser = { role };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <StatsPage view={view} />
    </QueryClientProvider>,
  );
}

describe("StatsPage visibility", () => {
  beforeEach(() => {
    mockGetStatsView.mockReset();
    mockSearchParams = new URLSearchParams();
    mockUser = { role: "owner" };
  });

  it("renders four loading rows for owners", () => {
    mockGetStatsView.mockReturnValue(new Promise(() => undefined));

    const { container } = renderPage("owner");

    expect(screen.getByText("4개")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-source-component="SettingsRowsSkeleton"]')).toHaveLength(4);
  });

  it("renders all four entries after the owner overview loads", async () => {
    mockGetStatsView.mockResolvedValue(OVERVIEW_RESPONSE);

    renderPage("owner");

    expect(await screen.findByText("오류")).toBeInTheDocument();
    expect(screen.getByText("상담")).toBeInTheDocument();
    expect(screen.getByText("페이지 이동")).toBeInTheDocument();
    expect(screen.getByText("트래픽")).toBeInTheDocument();
    expect(mockGetStatsView).toHaveBeenCalledWith("overview");
  });

  it("keeps requesting the owner overview on detail routes", async () => {
    mockGetStatsView.mockImplementation((view: unknown) => (
      view === "overview" ? Promise.resolve(OVERVIEW_RESPONSE) : new Promise(() => undefined)
    ));

    renderPage("owner", "inquiries");

    expect(await screen.findByText("4개")).toBeInTheDocument();
    expect(mockGetStatsView).toHaveBeenCalledWith("overview");
    expect(mockGetStatsView).toHaveBeenCalledWith("inquiries");
  });

  it("renders only inquiries for non-owners without requesting the owner overview", () => {
    mockGetStatsView.mockResolvedValue(OVERVIEW_RESPONSE);

    renderPage("admin");

    expect(screen.getByText("1개")).toBeInTheDocument();
    expect(screen.getByText("상담")).toBeInTheDocument();
    expect(screen.queryByText("오류")).not.toBeInTheDocument();
    expect(screen.queryByText("페이지 이동")).not.toBeInTheDocument();
    expect(screen.queryByText("트래픽")).not.toBeInTheDocument();
    expect(mockGetStatsView).not.toHaveBeenCalled();
  });

  it("keeps the branch inquiry detail available without owner entries", () => {
    mockGetStatsView.mockReturnValue(new Promise(() => undefined));

    renderPage("admin", "inquiries");

    expect(screen.getByText("1개")).toBeInTheDocument();
    expect(screen.getByText("상담")).toBeInTheDocument();
    expect(screen.queryByText("오류")).not.toBeInTheDocument();
    expect(screen.queryByText("페이지 이동")).not.toBeInTheDocument();
    expect(screen.queryByText("트래픽")).not.toBeInTheDocument();
    expect(mockGetStatsView).toHaveBeenCalledWith("inquiries");
    expect(mockGetStatsView).not.toHaveBeenCalledWith("overview");
  });
});
