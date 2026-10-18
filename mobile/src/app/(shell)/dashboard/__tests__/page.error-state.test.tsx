import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

import DashboardPage from "../page";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { useClientMessageHistory } from "@/hooks/useClientMessageHistory";
import { ClientDetailContent } from "@/components/app/clients/client-detail";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/hooks/useIssueContract", () => ({ useIssueContract: () => jest.fn() }));

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), redirect: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => ({ id: "qa-user" }) }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useClients", () => ({
  useDeleteClient: () => ({}),
  clientQueryKeys: { detail: jest.fn(), lists: jest.fn() },
}));
jest.mock("@/hooks/useInfiniteClients", () => ({ useInfiniteClients: jest.fn() }));
jest.mock("@/hooks/useDashboardAnalytics", () => ({ useDashboardAnalytics: jest.fn() }));
jest.mock("@/hooks/useClientMessageHistory", () => ({ useClientMessageHistory: jest.fn() }));
jest.mock("@/hooks/useListInfiniteScroll", () => ({ useListInfiniteScroll: () => ({ visibleCount: 8, isInitialLoad: true, hasMore: false }) }));
jest.mock("@/components/app/clients/ClientFormDialog", () => ({ ClientFormDialog: () => null }));
jest.mock("@/components/app/clients/client-detail", () => ({ ClientDetailContent: jest.fn(() => null) }));
jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({ MobileTwoButtonModal: () => null }));
jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({ MobileDetailSheet: ({ list, detail }: { list: ReactNode; detail: ReactNode }) => <>{list}{detail}</> }));

const clientsQuery = jest.mocked(useInfiniteClients);
const analyticsQuery = jest.mocked(useDashboardAnalytics);
const historyQuery = jest.mocked(useClientMessageHistory);
const detailContent = jest.mocked(ClientDetailContent);
const retryClients = jest.fn();
const retryAnalytics = jest.fn();

const cachedClient = { id: 1, name: "홍길동", actionRequired: true, serviceStatus: "active" };
const cachedAnalytics = { activeClients: 7, upcomingWithinWeek: 3, contractsPendingSignature: 2, contractsNotSent: 1 };

beforeEach(() => {
  jest.clearAllMocks();
  historyQuery.mockReturnValue({ notificationLogs: [], hasMore: false, isLoading: false, isError: false, isFetching: false, refetch: jest.fn() } as unknown as ReturnType<typeof useClientMessageHistory>);
  clientsQuery.mockReturnValue({ allClients: [], isLoading: false, isError: false, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
  analyticsQuery.mockReturnValue({ data: { activeClients: 0, upcomingThisMonth: 0, contractsPendingSignature: 0, contractsNotSent: 0 }, isLoading: false, isError: false, isFetching: false, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
});

it("retries the failed client query and recovers to a real empty result", () => {
  clientsQuery.mockReturnValue({ allClients: [], isLoading: false, isError: true, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
  const { rerender } = render(<DashboardPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("최근 현황을 불러오지 못했습니다.");
  expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("—");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retryClients).toHaveBeenCalledTimes(1);
  expect(retryAnalytics).not.toHaveBeenCalled();
  clientsQuery.mockReturnValue({ allClients: [], isLoading: false, isError: false, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
  rerender(<DashboardPage />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("최근 현황이 없습니다.")).toBeInTheDocument();
});

it("retries only the failed summary without presenting guessed counts", () => {
  analyticsQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, isFetching: false, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
  render(<DashboardPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("요약 정보를 불러오지 못했습니다.");
  expect(screen.queryByText("서비스 진행 중")).not.toBeInTheDocument();
  expect(screen.getByText("최근 현황이 없습니다.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(retryAnalytics).toHaveBeenCalledTimes(1);
  expect(retryClients).not.toHaveBeenCalled();
});

it("shows both failures without zero counts when both queries fail", () => {
  clientsQuery.mockReturnValue({ allClients: [], data: undefined, isLoading: false, isError: true, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
  analyticsQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
  render(<DashboardPage />);
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(screen.queryByText("0")).not.toBeInTheDocument();
  expect(screen.queryByText("최근 현황이 없습니다.")).not.toBeInTheDocument();
});

describe("cached data survives a failed refetch", () => {
  it("keeps the cached summary numbers and shows one inline notice that retries only the summary", () => {
    analyticsQuery.mockReturnValue({ data: cachedAnalytics, isLoading: false, isError: true, isFetching: false, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
    render(<DashboardPage />);
    expect(screen.getByText("서비스 진행 중")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText("요약 정보를 불러오지 못했습니다.")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    fireEvent.click(within(alert).getByRole("button", { name: /다시 시도/ }));
    expect(retryAnalytics).toHaveBeenCalledTimes(1);
    expect(retryClients).not.toHaveBeenCalled();
  });

  it("disables the summary notice's retry while the refetch is in flight", () => {
    analyticsQuery.mockReturnValue({ data: cachedAnalytics, isLoading: false, isError: true, isFetching: true, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
    render(<DashboardPage />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: /다시 시도/ })).toBeDisabled();
  });

  it("shows no alert after a successful summary load", () => {
    analyticsQuery.mockReturnValue({ data: cachedAnalytics, isLoading: false, isError: false, isFetching: false, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
    render(<DashboardPage />);
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the cached rows and pill counts and shows one inline notice that retries only the clients", () => {
    clientsQuery.mockReturnValue({ allClients: [cachedClient], hasData: true, isLoading: false, isError: true, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    render(<DashboardPage />);
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /전체/ })).not.toHaveTextContent("—");
    expect(screen.queryByText("최근 현황을 불러오지 못했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("최근 현황이 없습니다.")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    fireEvent.click(within(alert).getByRole("button", { name: /다시 시도/ }));
    expect(retryClients).toHaveBeenCalledTimes(1);
    expect(retryAnalytics).not.toHaveBeenCalled();
  });

  it("disables the clients notice's retry while the refetch is in flight", () => {
    clientsQuery.mockReturnValue({ allClients: [cachedClient], hasData: true, isLoading: false, isError: true, isFetching: true, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    render(<DashboardPage />);
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: /다시 시도/ })).toBeDisabled();
  });

  it("shows the rows with no alert after a successful clients load", () => {
    clientsQuery.mockReturnValue({ allClients: [cachedClient], isLoading: false, isError: false, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    render(<DashboardPage />);
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a paused load is loading, and a cached empty list is not a first-load failure", () => {
  const pausedNoData = { data: undefined, isPending: true, isLoading: false, isError: false, isFetching: false, isPaused: true, status: "pending", fetchStatus: "paused" };

  it("shows loading placeholders, no zeros, no empty text and no alert while both queries are paused with no data", () => {
    clientsQuery.mockReturnValue({ ...pausedNoData, allClients: [], hasData: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    analyticsQuery.mockReturnValue({ ...pausedNoData, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
    const { container } = render(<DashboardPage />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("최근 현황이 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component$="_loading-skeleton"]')).not.toBeNull();
    expect(container.querySelector(".filter-pill-skeleton")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /전체/ })).not.toBeInTheDocument();
  });

  it("shows the summary as loading, not as counts derived from the list, while only the summary query is paused with no data", () => {
    clientsQuery.mockReturnValue({ allClients: [cachedClient], hasData: true, isLoading: false, isError: false, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    analyticsQuery.mockReturnValue({ ...pausedNoData, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
    render(<DashboardPage />);
    expect(screen.queryByText("서비스 진행 중")).not.toBeInTheDocument();
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps showing cached rows when a refetch is paused", () => {
    clientsQuery.mockReturnValue({ allClients: [cachedClient], hasData: true, isPaused: true, isLoading: false, isError: false, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    analyticsQuery.mockReturnValue({ data: cachedAnalytics, isPaused: true, isLoading: false, isError: false, isFetching: false, refetch: retryAnalytics } as unknown as ReturnType<typeof useDashboardAnalytics>);
    render(<DashboardPage />);
    expect(screen.getByText("홍길동")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a cached EMPTY client list as a real empty state with real zeros when its refetch fails", () => {
    clientsQuery.mockReturnValue({ allClients: [], hasData: true, isLoading: false, isError: true, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    render(<DashboardPage />);
    expect(screen.getByText("최근 현황이 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText("최근 현황을 불러오지 못했습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("0");
    expect(screen.getByRole("button", { name: /전체/ })).not.toHaveTextContent("—");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  });

  it("still treats a first-load failure as the failure panel with unknown counts", () => {
    clientsQuery.mockReturnValue({ allClients: [], hasData: false, isLoading: false, isError: true, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    render(<DashboardPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("최근 현황을 불러오지 못했습니다.");
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("—");
    expect(screen.queryByText("최근 현황이 없습니다.")).not.toBeInTheDocument();
  });

  it("shows a successful empty list as an empty state with zeros and no alert", () => {
    clientsQuery.mockReturnValue({ allClients: [], hasData: true, isLoading: false, isError: false, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    render(<DashboardPage />);
    expect(screen.getByText("최근 현황이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("client detail message history", () => {
  const openDetail = () => {
    clientsQuery.mockReturnValue({ allClients: [cachedClient], isLoading: false, isError: false, isFetching: false, refetch: retryClients } as unknown as ReturnType<typeof useInfiniteClients>);
    render(<DashboardPage />);
    fireEvent.click(screen.getByText("홍길동"));
  };
  const lastDetailProps = () => detailContent.mock.calls[detailContent.mock.calls.length - 1][0];

  it.each([
    { isPaused: true, hasData: false, isLoading: false, expected: true },
    { isPaused: true, hasData: true, isLoading: false, expected: false },
    { isPaused: false, hasData: false, isLoading: false, expected: false },
    { isPaused: false, hasData: false, isLoading: true, expected: true },
  ])("passes the notification loading state for %j", ({ expected, ...state }) => {
    historyQuery.mockReturnValue({ notificationLogs: [], hasMore: false, isError: false, isFetching: false, refetch: jest.fn(), ...state } as unknown as ReturnType<typeof useClientMessageHistory>);
    openDetail();
    expect(lastDetailProps().isNotificationLogsLoading).toBe(expected);
  });

  it("tells the detail its retry is in flight while the history query is fetching", () => {
    historyQuery.mockReturnValue({ notificationLogs: [], hasMore: false, isLoading: false, isError: true, isFetching: true, refetch: jest.fn() } as unknown as ReturnType<typeof useClientMessageHistory>);
    openDetail();
    expect(lastDetailProps().isNotificationLogsRetrying).toBe(true);
  });

  it("does not mark the retry in flight when the history query is idle", () => {
    openDetail();
    expect(lastDetailProps().isNotificationLogsRetrying).toBe(false);
  });
});
