import { fireEvent, render, screen, within } from "@testing-library/react";

import { useDashboardOverview, type DashboardOverview } from "@/hooks/useDashboardStats";
import type { Client } from "@/lib/client/types";
import DashboardPage from "./page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: jest.fn(),
}));
jest.mock("@/hooks/useDashboardStats", () => ({ useDashboardOverview: jest.fn() }));
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => ({ id: "test" }) }));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({ useBusinessDayCalendar: () => ({}) }));
jest.mock("@/components/app/clients/ClientDetailPanel", () => ({ ClientDetailPanel: () => null }));
jest.mock("@/lib/dashboard/client-due", () => ({
  ...jest.requireActual("@/lib/dashboard/client-due"),
  isServiceEndingNextBusinessDay: () => true,
}));

const client: Client = {
  id: 1, name: "캐시 고객", birthday: null, dueDate: null, birthDate: null,
  address: null, phone: null, primaryEmployee: null, secondaryEmployee: null,
  type: null, duration: null, fullPrice: null, grant: null, actualPrice: null,
  startDate: null, endDate: null, careCenter: null, voucherClient: false,
  breastPump: false, serviceStatus: "active", eDocId: null, hasSigned: false,
  documentStatus: null,
};

function overview(rows: Client[]): DashboardOverview {
  return {
    stats: { activeClients: 0, contractsNotSent: 0, contractsPendingSignature: 0, upcomingThisMonth: 0, upcomingNextMonth: 0 },
    clients: { data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 },
  };
}

const refetch = jest.fn();
let state: { data: DashboardOverview | undefined; isError: boolean; isLoading: boolean; isFetching: boolean; refetch: typeof refetch };

function statValues(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]'), (node) => node.textContent);
}

beforeEach(() => {
  refetch.mockReset();
  state = { data: undefined, isError: true, isLoading: false, isFetching: false, refetch };
  // Only the query fields consumed by this page are mocked; components render unchanged.
  jest.mocked(useDashboardOverview).mockImplementation(() => state as unknown as ReturnType<typeof useDashboardOverview>);
});

describe("DashboardPage load failure", () => {
  it("keeps the existing retry UI and shows unknown stats without cached data", () => {
    const { container } = render(<DashboardPage />);
    expect(screen.getByText("데이터를 불러올 수 없습니다")).toBeVisible();
    expect(screen.queryByText("종료 1영업일 전인 계약이 없습니다")).not.toBeInTheDocument();
    expect(statValues(container)).toEqual(["—", "—", "—"]);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders successful empty data as empty with real zeroes and no alert", () => {
    state = { ...state, data: overview([]), isError: false };
    const { container } = render(<DashboardPage />);
    expect(screen.getByText("종료 1영업일 전인 계약이 없습니다")).toBeVisible();
    expect(statValues(container)).toEqual(["0", "0", "0"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("데이터를 불러올 수 없습니다")).not.toBeInTheDocument();
  });

  it("keeps cached rows and stats above a failed refetch and disables the inline retry in flight", () => {
    state = { ...state, data: overview([client]), isError: false };
    const { container, rerender } = render(<DashboardPage />);
    state = { ...state, isError: true };
    rerender(<DashboardPage />);
    const alert = screen.getByRole("alert");
    const row = screen.getByText("캐시 고객");
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row).toBeVisible();
    expect(statValues(container)).toEqual(["1", "0", "0"]);
    expect(screen.queryByText("데이터를 불러올 수 없습니다")).not.toBeInTheDocument();
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    state = { ...state, isFetching: true };
    rerender(<DashboardPage />);
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(screen.getByText("캐시 고객")).toBeVisible();
  });

  it("keeps a cached empty result with an inline notice rather than a blocking error", () => {
    state = { ...state, data: overview([]) };
    const { container } = render(<DashboardPage />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(screen.getByText("종료 1영업일 전인 계약이 없습니다")).toBeVisible();
    expect(statValues(container)).toEqual(["0", "0", "0"]);
  });

  it("keeps the existing loading state while a no-data retry is fetching", () => {
    state = { ...state, isError: false, isLoading: true, isFetching: true };
    const { container } = render(<DashboardPage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("데이터를 불러올 수 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("종료 1영업일 전인 계약이 없습니다")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
