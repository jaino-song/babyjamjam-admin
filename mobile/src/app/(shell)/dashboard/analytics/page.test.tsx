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

  it("shows a retryable failure instead of stats when the stats failed with nothing cached", () => {
    mockAnalytics({ data: undefined, isError: true });
    render(<DashboardAnalyticsPage />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("통계를 불러오지 못했습니다");
    expect(screen.queryByText("전체 고객")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: /다시 시도/ }));
    expect(retryAnalytics).toHaveBeenCalledTimes(1);
    expect(retryClients).not.toHaveBeenCalled();
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
});
