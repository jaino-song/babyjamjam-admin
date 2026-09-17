import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import DashboardPage from "../page";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";

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
jest.mock("@/hooks/useClientMessageHistory", () => ({ useClientMessageHistory: () => ({ notificationLogs: [] }) }));
jest.mock("@/hooks/useListInfiniteScroll", () => ({ useListInfiniteScroll: () => ({ visibleCount: 8, isInitialLoad: true, hasMore: false }) }));
jest.mock("@/components/app/clients/ClientFormDialog", () => ({ ClientFormDialog: () => null }));
jest.mock("@/components/app/clients/client-detail", () => ({ ClientDetailContent: () => null }));
jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({ MobileTwoButtonModal: () => null }));
jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({ MobileDetailSheet: ({ list }: { list: ReactNode }) => <>{list}</> }));

const clientsQuery = jest.mocked(useInfiniteClients);
const analyticsQuery = jest.mocked(useDashboardAnalytics);
const retryClients = jest.fn();
const retryAnalytics = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
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
