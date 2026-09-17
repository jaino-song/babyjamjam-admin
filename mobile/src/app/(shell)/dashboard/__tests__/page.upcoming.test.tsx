import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import DashboardPage from "../page";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import type { Client } from "@/lib/client/types";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }), redirect: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => ({ id: "qa-user" }) }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useClients", () => ({
  clientQueryKeys: { detail: jest.fn(), lists: jest.fn() },
  useDeleteClient: () => ({}),
}));
jest.mock("@/hooks/useInfiniteClients", () => ({ useInfiniteClients: jest.fn() }));
jest.mock("@/hooks/useDashboardAnalytics", () => ({ useDashboardAnalytics: jest.fn() }));
jest.mock("@/hooks/useClientMessageHistory", () => ({ useClientMessageHistory: () => ({ notificationLogs: [] }) }));
jest.mock("@/hooks/useListInfiniteScroll", () => ({ useListInfiniteScroll: () => ({ visibleCount: 8, isInitialLoad: true, hasMore: false }) }));
jest.mock("@/hooks/use-toast", () => ({ toast: jest.fn() }));
jest.mock("@/components/app/clients/ClientFormDialog", () => ({ ClientFormDialog: () => null }));
jest.mock("@/components/app/clients/client-detail", () => ({ ClientDetailContent: () => null }));
jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({ MobileTwoButtonModal: () => null }));
jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ list }: { list: ReactNode }) => <>{list}</>,
}));

const clientsQuery = jest.mocked(useInfiniteClients);
const analyticsQuery = jest.mocked(useDashboardAnalytics);
const NOW = new Date("2026-06-10T12:00:00+09:00");

const plannedClient: Client = {
  id: 163,
  name: "QA 예정 고객",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: null,
  phone: null,
  primaryEmployee: null,
  secondaryEmployee: null,
  type: "A통합1형",
  duration: null,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: "2026-06-12T00:00:00+09:00",
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const plannedClientOnPageTwo: Client = {
  ...plannedClient,
  id: 164,
  name: "QA 2페이지 예정 고객",
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  clientsQuery.mockReturnValue({
    allClients: [plannedClient, plannedClientOnPageTwo],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useInfiniteClients>);
  analyticsQuery.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useDashboardAnalytics>);
});

afterEach(() => {
  jest.useRealTimers();
});

it("includes an eligible page-two pre-booking client in the upcoming filter count and rows", () => {
  render(<DashboardPage />);

  const upcomingFilter = screen.getByRole("button", { name: /시작 예정/ });
  expect(upcomingFilter).toHaveTextContent("2");

  fireEvent.click(upcomingFilter);

  expect(screen.getByText("QA 예정 고객")).toBeInTheDocument();
  expect(screen.getByText("QA 2페이지 예정 고객")).toBeInTheDocument();
  expect(clientsQuery).toHaveBeenCalledWith({ staleTime: 60_000 });
});
