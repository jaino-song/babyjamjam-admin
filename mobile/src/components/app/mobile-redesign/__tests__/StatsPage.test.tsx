import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { StatsViewResponse } from "@/lib/observability/stats-server";

import { StatsPage } from "../StatsPage";

const mockGetStatsView = jest.fn();
let mockSearchParams = new URLSearchParams("period=7");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/stats",
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => ({ id: 1, role: "owner" }),
}));

jest.mock("@/lib/api/stats", () => ({
  getStatsView: (...args: unknown[]) => mockGetStatsView(...args),
}));

// Unlike the other StatsPage suites, this one renders the header trailing slot: the status pill is under test.
jest.mock("../sliding-card", () => ({
  SlidingCard: ({
    list,
    detail,
    open,
    detailHeaderTrailing,
  }: {
    list: ReactNode;
    detail: ReactNode;
    open: boolean;
    detailHeaderTrailing?: ReactNode;
  }) => (
    <div data-testid="sliding-card">
      {list}
      {open ? (
        <div data-testid="detail-pane">
          <div data-testid="detail-header-trailing">{detailHeaderTrailing}</div>
          {detail}
        </div>
      ) : null}
    </div>
  ),
}));

jest.mock("../StatsPeriodSelector", () => ({
  StatsPeriodSelector: ({ period }: { period: number }) => <output aria-label="선택 기간">{period}</output>,
}));

const FAILED_DETAIL = "통계 데이터를 불러오지 못했습니다.";
const NEEDS_CONNECTION = "데이터 연결이 필요합니다.";
const STALE_NOTICE = "최신 정보를 불러오지 못했습니다";
const OVERVIEW_FAILED = "통계 개요를 불러오지 못했습니다.";
const DETAIL_LOADING = "데이터를 불러오는 중…";

const AVAILABILITY = { posthog: "ready", sentry: "ready" } as const;

const OVERVIEW_READY: StatsViewResponse<"overview"> = {
  view: "overview",
  availability: AVAILABILITY,
  state: "ready",
  data: { errors: null, inquiries: null, funnel: null, traffic: null, topPages: null, devices: null },
};

const TRAFFIC_READY: StatsViewResponse<"traffic"> = {
  view: "traffic",
  availability: AVAILABILITY,
  state: "ready",
  data: {
    summary: {
      today: { pv: 11, unique: 5 },
      yesterday: { pv: 9, unique: 4 },
      sevenDayTotal: { pv: 70, unique: 30 },
      avgSessionSeconds: 42,
      bounceRate: 10,
      selectedRange: { days: 7, total: { pv: 70, unique: 30 }, avgSessionSeconds: 42, bounceRate: 10 },
    },
    trend: [],
    topPages: [],
    devices: [],
    browsers: [],
    sources: [],
    regions: [],
  },
};

const TRAFFIC_UNAVAILABLE: StatsViewResponse<"traffic"> = {
  view: "traffic",
  availability: { posthog: "unavailable", sentry: "ready" },
  state: "unavailable",
  data: null,
};

function renderPage(view: "overview" | "traffic") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StatsPage view={view} />
    </QueryClientProvider>,
  );
  return { queryClient };
}

function headerPill(): HTMLElement {
  return screen.getByTestId("detail-header-trailing");
}

function detailPane(): HTMLElement {
  return screen.getByTestId("detail-pane");
}

function mockViews(overview: () => unknown, traffic: () => unknown) {
  mockGetStatsView.mockImplementation((view: string) => {
    try {
      return Promise.resolve(view === "overview" ? overview() : traffic());
    } catch (error) {
      return Promise.reject(error);
    }
  });
}

describe("StatsPage unknown loads (BJJ-434)", () => {
  beforeEach(() => {
    mockGetStatsView.mockReset();
    mockSearchParams = new URLSearchParams("period=7");
  });

  describe("overview", () => {
    it("paused with nothing cached shows the skeleton rows, not the list or a failure", async () => {
      mockViews(() => OVERVIEW_READY, () => TRAFFIC_READY);
      onlineManager.setOnline(false);
      try {
        renderPage("overview");

        expect(document.body.querySelectorAll('[data-source-component="SettingsRowsSkeleton"]')).toHaveLength(4);
        expect(screen.queryByText(OVERVIEW_FAILED)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "오류 통계 보기" })).not.toBeInTheDocument();
        expect(mockGetStatsView).not.toHaveBeenCalled();
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it("failed shows the rows with dashes and exactly one failure row whose retry refetches", async () => {
      let fail = true;
      mockViews(
        () => {
          if (fail) throw new Error("boom");
          return OVERVIEW_READY;
        },
        () => TRAFFIC_READY,
      );
      renderPage("overview");

      expect(await screen.findByText(OVERVIEW_FAILED)).toBeInTheDocument();
      expect(screen.getAllByText(OVERVIEW_FAILED)).toHaveLength(1);
      for (const id of ["errors", "inquiries", "funnel", "traffic"]) {
        expect(document.querySelector(`[data-component$="_item-${id}_value"]`)).toHaveTextContent(/^—$/);
      }

      fail = false;
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      await waitFor(() => expect(screen.queryByText(OVERVIEW_FAILED)).not.toBeInTheDocument());
      expect(mockGetStatsView).toHaveBeenCalledTimes(2);
    });

    it("a successful overview shows its rows and no failure", async () => {
      mockViews(() => OVERVIEW_READY, () => TRAFFIC_READY);
      renderPage("overview");

      expect(await screen.findByText("오류")).toBeInTheDocument();
      expect(screen.queryByText(OVERVIEW_FAILED)).not.toBeInTheDocument();
    });
  });

  describe("detail", () => {
    it("paused with nothing cached shows the loading card, no failure text and no header pill", async () => {
      mockViews(() => OVERVIEW_READY, () => TRAFFIC_READY);
      onlineManager.setOnline(false);
      try {
        renderPage("traffic");

        expect(await screen.findByText(DETAIL_LOADING)).toBeInTheDocument();
        expect(screen.queryByText(FAILED_DETAIL)).not.toBeInTheDocument();
        expect(screen.queryByText(NEEDS_CONNECTION)).not.toBeInTheDocument();
        expect(headerPill()).toBeEmptyDOMElement();
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it("loading shows the loading card and no header pill", () => {
      mockGetStatsView.mockImplementation((view: string) =>
        view === "overview" ? Promise.resolve(OVERVIEW_READY) : new Promise(() => undefined),
      );
      renderPage("traffic");

      expect(screen.getByText(DETAIL_LOADING)).toBeInTheDocument();
      expect(headerPill()).toBeEmptyDOMElement();
    });

    it("failed with nothing cached shows the failure card with a retry and the 조회 오류 pill, never 연결 필요", async () => {
      let fail = true;
      mockViews(
        () => OVERVIEW_READY,
        () => {
          if (fail) throw new Error("boom");
          return TRAFFIC_READY;
        },
      );
      renderPage("traffic");

      expect(await within(detailPane()).findByText(FAILED_DETAIL)).toBeInTheDocument();
      expect(within(detailPane()).queryByText(NEEDS_CONNECTION)).not.toBeInTheDocument();
      expect(headerPill()).toHaveTextContent("조회 오류");
      expect(headerPill()).not.toHaveTextContent("연결 필요");

      fail = false;
      fireEvent.click(within(detailPane()).getByRole("button", { name: "다시 시도" }));
      expect(await within(detailPane()).findByText(/PostHog 사이트 트래픽/)).toBeInTheDocument();
      expect(within(detailPane()).queryByText(FAILED_DETAIL)).not.toBeInTheDocument();
      expect(headerPill()).toHaveTextContent("PostHog");
    });

    it("a response reporting the source as not connected says so and shows the 연결 필요 pill", async () => {
      mockViews(() => OVERVIEW_READY, () => TRAFFIC_UNAVAILABLE);
      renderPage("traffic");

      expect(await within(detailPane()).findByText(NEEDS_CONNECTION)).toBeInTheDocument();
      expect(within(detailPane()).queryByText(FAILED_DETAIL)).not.toBeInTheDocument();
      expect(headerPill()).toHaveTextContent("연결 필요");
      expect(screen.queryByText(STALE_NOTICE)).not.toBeInTheDocument();
    });

    it("a failed refetch keeps the cached report under exactly one notice whose retry refetches the detail", async () => {
      let failDetail = false;
      mockViews(
        () => OVERVIEW_READY,
        () => {
          if (failDetail) throw new Error("boom");
          return TRAFFIC_READY;
        },
      );
      const { queryClient } = renderPage("traffic");
      expect(await within(detailPane()).findByText(/PostHog 사이트 트래픽/)).toBeInTheDocument();

      failDetail = true;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["stats", "traffic"] });
      });

      const alert = await within(detailPane()).findByRole("alert");
      expect(within(detailPane()).getAllByRole("alert")).toHaveLength(1);
      expect(within(alert).getByText(STALE_NOTICE)).toBeInTheDocument();
      expect(within(detailPane()).getByText(/PostHog 사이트 트래픽/)).toBeInTheDocument();
      expect(within(detailPane()).queryByText(FAILED_DETAIL)).not.toBeInTheDocument();
      expect(headerPill()).toHaveTextContent("PostHog");

      // A retry still in flight disables the button.
      let release: (value: unknown) => void = () => undefined;
      mockGetStatsView.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
      await waitFor(() =>
        expect(within(within(detailPane()).getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeDisabled(),
      );
      expect(within(detailPane()).getByText(/PostHog 사이트 트래픽/)).toBeInTheDocument();

      await act(async () => {
        release(TRAFFIC_READY);
      });
      await waitFor(() => expect(within(detailPane()).queryByRole("alert")).not.toBeInTheDocument());
      expect(within(detailPane()).getByText(/PostHog 사이트 트래픽/)).toBeInTheDocument();
    });

    it("a failed refetch of a not-connected response keeps that card plus the notice", async () => {
      let failDetail = false;
      mockViews(
        () => OVERVIEW_READY,
        () => {
          if (failDetail) throw new Error("boom");
          return TRAFFIC_UNAVAILABLE;
        },
      );
      const { queryClient } = renderPage("traffic");
      expect(await within(detailPane()).findByText(NEEDS_CONNECTION)).toBeInTheDocument();

      failDetail = true;
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: ["stats", "traffic"] });
      });

      expect(await within(detailPane()).findByText(STALE_NOTICE)).toBeInTheDocument();
      expect(within(detailPane()).getByText(NEEDS_CONNECTION)).toBeInTheDocument();
      expect(within(detailPane()).queryByText(FAILED_DETAIL)).not.toBeInTheDocument();
      expect(headerPill()).toHaveTextContent("연결 필요");
    });
  });
});
