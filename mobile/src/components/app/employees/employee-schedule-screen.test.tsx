import { act, fireEvent, render, screen } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useClientDetailController } from "@/components/app/clients/client-detail-controller";
import { EmployeeScheduleScreen } from "./employee-schedule-screen";

jest.mock("@/hooks/useInfiniteClients", () => ({
  useInfiniteClients: jest.fn(),
}));

jest.mock("@/components/app/clients/client-detail-controller", () => ({
  useClientDetailController: jest.fn(),
}));

const mockedUseInfiniteClients = jest.mocked(useInfiniteClients);
const mockedUseClientDetailController = jest.mocked(useClientDetailController);

function makeClient(id: number, overrides: Partial<Client> = {}): Client {
  return {
    id,
    name: `고객 ${id}`,
    birthday: null,
    dueDate: null,
    birthDate: null,
    address: null,
    phone: null,
    primaryEmployee: { id: id + 100, name: `관리사 ${id}` },
    secondaryEmployee: null,
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: true,
    breastPump: false,
    serviceStatus: "active",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  };
}

function mockClients(clients: Client[], overrides: Record<string, unknown> = {}) {
  mockedUseInfiniteClients.mockReturnValue({
    allClients: clients,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useInfiniteClients>);
}

describe("EmployeeScheduleScreen", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-16T09:00:00+09:00"));
    mockedUseClientDetailController.mockImplementation(({ client }) => ({
      detailClient: client ?? null,
      detail: client ? <section role="region" aria-label="고객 상세">{client.name}</section> : null,
      detailSheetTab: "basic",
      setDetailSheetTab: jest.fn(),
      isDetailRefreshing: false,
      detailRefreshError: false,
      retryDetail: jest.fn(),
      deleteModal: null,
      deleteTargetClientId: null,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("shows the inclusive calendar, selected-day agenda, view toggle, and detail slide", () => {
    const client = makeClient(1, { startDate: "2026-09-18" });
    mockClients([client]);
    const { container } = render(<EmployeeScheduleScreen />);

    expect(screen.getByRole("button", { name: "달력" })).toHaveAttribute("aria-pressed", "true");
    const day = container.querySelector('[data-slot="calendar-day"][data-date="2026-09-18"]');
    expect(day).toBeInTheDocument();
    fireEvent.click(day!);
    expect(screen.getByText("고객 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /고객 1/ }));
    expect(screen.getByRole("region", { name: "고객 상세" })).toHaveTextContent("고객 1");
    expect(container.querySelector('[data-slot="sliding-card"]')).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "서비스 일정 목록으로 돌아가기" }));
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    expect(screen.getByRole("button", { name: /고객 1/ })).toBeInTheDocument();
  });

  it("filters by schedule kind and client search", () => {
    mockClients([
      makeClient(1, { startDate: "2026-09-18" }),
      makeClient(2, { endDate: "2026-09-20" }),
    ]);
    render(<EmployeeScheduleScreen />);

    fireEvent.click(screen.getByRole("button", { name: /서비스 종료/ }));
    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    expect(screen.getByText("고객 2")).toBeInTheDocument();
    expect(screen.queryByText("고객 1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "고객 이름, 제공인력 검색" }), {
      target: { value: "고객 2" },
    });
    expect(screen.getByText("고객 2")).toBeInTheDocument();
  });

  it("keeps schedule entries beyond the first 50 clients", () => {
    const clients = Array.from({ length: 50 }, (_, index) => makeClient(index + 1));
    clients.push(makeClient(51, { startDate: "2026-09-19", name: "추가 일정 고객" }));
    mockClients(clients);
    render(<EmployeeScheduleScreen />);

    fireEvent.click(screen.getByRole("button", { name: "목록" }));
    expect(screen.getByText("추가 일정 고객")).toBeInTheDocument();
  });

  it("renders a retryable schedule error", () => {
    const refetch = jest.fn();
    mockClients([], { allClients: [], isLoading: false, isError: true, refetch });
    render(<EmployeeScheduleScreen />);

    expect(screen.getByRole("alert")).toHaveTextContent("일정을 불러오지 못했습니다");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("closes the selected schedule detail when the controller reports a deleted client", () => {
    const client = makeClient(1, { startDate: "2026-09-18" });
    mockClients([client]);
    render(<EmployeeScheduleScreen />);

    fireEvent.click(screen.getByRole("button", { name: /2026년 9월 18일/ }));
    fireEvent.click(screen.getByRole("button", { name: /고객 1/ }));
    expect(screen.getByRole("region", { name: "고객 상세" })).toBeInTheDocument();

    const latestControllerOptions = mockedUseClientDetailController.mock.calls.at(-1)?.[0];
    expect(latestControllerOptions?.onClientDeleted).toEqual(expect.any(Function));
    act(() => latestControllerOptions?.onClientDeleted?.(client.id));

    expect(screen.queryByRole("region", { name: "고객 상세" })).not.toBeInTheDocument();
  });
});
