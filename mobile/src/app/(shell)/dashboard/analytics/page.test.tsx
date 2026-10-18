import { fireEvent, render, screen, within } from "@testing-library/react";

import DashboardAnalyticsPage from "./page";
import { useClients } from "@/hooks/useClients";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";

jest.mock("@/hooks/useClients", () => ({ useClients: jest.fn() }));
jest.mock("@/hooks/useDashboardAnalytics", () => ({ useDashboardAnalytics: jest.fn() }));

const clientsQuery = jest.mocked(useClients);
const analyticsQuery = jest.mocked(useDashboardAnalytics);
const retryClients = jest.fn();
const retryAnalytics = jest.fn();

const analyticsData = { activeClients: 7, upcomingWithinWeek: 3, contractsPendingSignature: 2, contractsNotSent: 1 };

function mockClients(state: Record<string, unknown>) {
  clientsQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false, isFetching: false, refetch: retryClients, ...state } as unknown as ReturnType<typeof useClients>);
}
function mockAnalytics(state: Record<string, unknown>) {
  analyticsQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false, isFetching: false, refetch: retryAnalytics, ...state } as unknown as ReturnType<typeof useDashboardAnalytics>);
}
const totalClientsValue = () => screen.getByText("전체 고객").previousElementSibling;

beforeEach(() => {
  jest.clearAllMocks();
  mockClients({ data: { total: 12 } });
  mockAnalytics({ data: analyticsData });
});

describe("DashboardAnalyticsPage load failures", () => {
  it("shows the stats and no alert after a successful load", () => {
    render(<DashboardAnalyticsPage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(totalClientsValue()).toHaveTextContent("12");
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows a real zero client total as 0", () => {
    mockClients({ data: { total: 0 } });
    render(<DashboardAnalyticsPage />);
    expect(totalClientsValue()).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retryable inline failure above the stats when the stats failed with nothing cached", () => {
    mockAnalytics({ data: undefined, isError: true });
    render(<DashboardAnalyticsPage />);
    const alert = screen.getByText("통계를 불러오지 못했습니다").closest('[role="alert"]') as HTMLElement;
    expect(alert).toHaveTextContent("통계를 불러오지 못했습니다");
    expect(screen.getByText("전체 고객")).toBeInTheDocument();
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert.nextElementSibling).toHaveAttribute("data-component", "mobile_dashboard_analytics-page_card_grid");
    fireEvent.click(within(alert).getByRole("button", { name: /다시 시도/ }));
    expect(retryAnalytics).toHaveBeenCalledTimes(1);
    expect(retryClients).not.toHaveBeenCalled();
  });

  it("shows — instead of 0 while the client count is paused with no data", () => {
    mockClients({ data: undefined, isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: true, status: "pending", fetchStatus: "paused" });
    render(<DashboardAnalyticsPage />);
    expect(totalClientsValue()).toHaveTextContent("—");
    expect(totalClientsValue()).not.toHaveTextContent("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows placeholders without an alert while analytics is paused with no data", () => {
    mockAnalytics({ data: undefined, isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: true, status: "pending", fetchStatus: "paused" });
    render(<DashboardAnalyticsPage />);
    expect(Array.from(document.querySelectorAll(".mini-stat-num")).map((el) => el.textContent)).toEqual(["12", "—", "—", "—"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached values when both refetches are paused", () => {
    mockClients({ data: { total: 12 }, isPaused: true });
    mockAnalytics({ data: analyticsData, isPaused: true });
    render(<DashboardAnalyticsPage />);
    expect(Array.from(document.querySelectorAll(".mini-stat-num")).map((el) => el.textContent)).toEqual(["12", "7", "3", "3"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves the idle no-data rendering when queries are not paused", () => {
    mockClients({ data: undefined, isPending: true, isPaused: false });
    mockAnalytics({ data: undefined, isPending: true, isPaused: false });
    render(<DashboardAnalyticsPage />);
    expect(Array.from(document.querySelectorAll(".mini-stat-num")).map((el) => el.textContent)).toEqual(["0", "-", "-", "-"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the cached client total and both notices when analytics failed with no data", () => {
    mockClients({ data: { total: 12 }, isError: true });
    mockAnalytics({ data: undefined, isError: true });
    render(<DashboardAnalyticsPage />);
    expect(Array.from(document.querySelectorAll(".mini-stat-num")).map((el) => el.textContent)).toEqual(["12", "—", "—", "—"]);
    const analyticsAlert = screen.getByText("통계를 불러오지 못했습니다").closest('[role="alert"]') as HTMLElement;
    const clientsAlert = screen.getByText("최신 정보를 불러오지 못했습니다").closest('[role="alert"]') as HTMLElement;
    expect(analyticsAlert).toHaveAttribute("data-size", "inline");
    expect(clientsAlert).toBeInTheDocument();
    fireEvent.click(within(analyticsAlert).getByRole("button", { name: /다시 시도/ }));
    expect(retryAnalytics).toHaveBeenCalledTimes(1);
    expect(retryClients).not.toHaveBeenCalled();
  });

  it("keeps the grid with unknown counts when both queries failed without cached data", () => {
    mockClients({ data: undefined, isError: true });
    mockAnalytics({ data: undefined, isError: true, isFetching: true });
    render(<DashboardAnalyticsPage />);
    expect(Array.from(document.querySelectorAll(".mini-stat-num")).map((el) => el.textContent)).toEqual(["—", "—", "—", "—"]);
    const alert = screen.getByText("통계를 불러오지 못했습니다").closest('[role="alert"]') as HTMLElement;
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(within(alert).getByRole("button", { name: /다시 시도/ })).toBeDisabled();
    expect(screen.getByText("전체 고객 정보를 불러오지 못했습니다")).toBeInTheDocument();
  });

  it("keeps the cached stats under one inline notice when a refetch failed", () => {
    mockAnalytics({ data: analyticsData, isError: true });
    render(<DashboardAnalyticsPage />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(totalClientsValue()).toHaveTextContent("12");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    fireEvent.click(within(alert).getByRole("button", { name: /다시 시도/ }));
    expect(retryAnalytics).toHaveBeenCalledTimes(1);
  });

  it("disables the cached-stats notice's retry while the refetch is in flight", () => {
    mockAnalytics({ data: analyticsData, isError: true, isFetching: true });
    render(<DashboardAnalyticsPage />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: /다시 시도/ })).toBeDisabled();
  });

  it("shows — instead of 0 for the client total when the count failed with nothing cached", () => {
    mockClients({ data: undefined, isError: true });
    render(<DashboardAnalyticsPage />);
    expect(totalClientsValue()).toHaveTextContent("—");
    expect(totalClientsValue()).not.toHaveTextContent("0");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("전체 고객 정보를 불러오지 못했습니다");
    fireEvent.click(within(alert).getByRole("button", { name: /다시 시도/ }));
    expect(retryClients).toHaveBeenCalledTimes(1);
    expect(retryAnalytics).not.toHaveBeenCalled();
  });

  it("keeps the cached client total under an inline notice when the count refetch failed", () => {
    mockClients({ data: { total: 12 }, isError: true });
    render(<DashboardAnalyticsPage />);
    expect(totalClientsValue()).toHaveTextContent("12");
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  });

  it("keeps the cached stats while the client count is in its initial load and the stats refetch failed", () => {
    mockClients({ data: undefined, isLoading: true });
    mockAnalytics({ data: analyticsData, isError: true });
    render(<DashboardAnalyticsPage />);
    const values = Array.from(document.querySelectorAll(".mini-stat-num")).map((el) => el.textContent);
    expect(values).toEqual(["—", "7", "3", "3"]);
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  });

  it("keeps the cached client total while the stats are in their initial load", () => {
    mockClients({ data: { total: 12 } });
    mockAnalytics({ data: undefined, isLoading: true });
    render(<DashboardAnalyticsPage />);
    const values = Array.from(document.querySelectorAll(".mini-stat-num")).map((el) => el.textContent);
    expect(values).toEqual(["12", "—", "—", "—"]);
  });

  it("retries only the client count from the cached-count notice", () => {
    mockClients({ data: { total: 12 }, isError: true });
    render(<DashboardAnalyticsPage />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    fireEvent.click(within(alert).getByRole("button", { name: /다시 시도/ }));
    expect(retryClients).toHaveBeenCalledTimes(1);
    expect(retryAnalytics).not.toHaveBeenCalled();
  });

  it("disables the cached-count notice's retry while the client refetch is in flight", () => {
    mockClients({ data: { total: 12 }, isError: true, isFetching: true });
    render(<DashboardAnalyticsPage />);
    expect(totalClientsValue()).toHaveTextContent("12");
    expect(within(screen.getByRole("alert")).getByRole("button", { name: /다시 시도/ })).toBeDisabled();
  });
});
