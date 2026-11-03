import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import DashboardPage from "../page";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useDashboardAnalytics } from "@/hooks/useDashboardAnalytics";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import type { Client } from "@/lib/client/types";
import { createKrBusinessDayCalendar, getKoreanHolidays, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("@/hooks/useIssueContract", () => ({ useIssueContract: () => jest.fn() }));

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
jest.mock("@/hooks/useListInfiniteScroll", () => ({ useListInfiniteScroll: jest.fn() }));
jest.mock("@/hooks/use-toast", () => ({ toast: jest.fn() }));
jest.mock("@/components/app/clients/ClientFormDialog", () => ({ ClientFormDialog: () => null }));
jest.mock("@/components/app/clients/client-detail", () => ({ ClientDetailContent: () => null }));
jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({ MobileTwoButtonModal: () => null }));
jest.mock("@/components/app/mobile-redesign/detail-sheet", () => ({
  MobileDetailSheet: ({ list }: { list: ReactNode }) => <>{list}</>,
}));

const clientsQuery = jest.mocked(useInfiniteClients);
const analyticsQuery = jest.mocked(useDashboardAnalytics);
const listScrollHook = jest.mocked(useListInfiniteScroll);
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
  bookingConfirmedAt: null,
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
  listScrollHook.mockReturnValue({ visibleCount: 8, isInitialLoad: true, hasMore: false } as ReturnType<typeof useListInfiniteScroll>);
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

it("keeps all dashboard records reachable through the sentinel with the manual footer hidden", () => {
  const originalIntersection = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
  const originalResize = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
  const observers: Array<{ notify: (isIntersecting: boolean) => void; observe: jest.Mock }> = [];
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: jest.fn().mockImplementation((callback: IntersectionObserverCallback) => {
      const observer = {
        notify: (isIntersecting: boolean) => callback(
          [{ isIntersecting } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
        observe: jest.fn(),
        disconnect: jest.fn(),
      };
      observers.push(observer);
      return observer;
    }),
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: jest.fn().mockImplementation(() => ({ observe: jest.fn(), disconnect: jest.fn() })),
  });
  jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(250);
  jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
  listScrollHook.mockImplementation(jest.requireActual("@/hooks/useListInfiniteScroll").useListInfiniteScroll);
  const clients = Array.from({ length: 15 }, (_, index) => ({
    ...plannedClient,
    id: 200 + index,
    name: `자동 스크롤 고객 ${index + 1}`,
  }));
  clientsQuery.mockReturnValue({
    ...clientsQuery(),
    allClients: clients,
  } as ReturnType<typeof useInfiniteClients>);

  try {
    const { container } = render(<DashboardPage />);
    const sentinelSelector = '[data-component="mobile_dashboard_page_content_list-card_body_load-sentinel"]';
    expect(container.querySelector('[data-component="mobile_dashboard_page_content_list-card_load-more"]')).not.toBeInTheDocument();
    expect(screen.getByText("자동 스크롤 고객 1")).toBeInTheDocument();
    expect(screen.queryByText("자동 스크롤 고객 15")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".list-item")).toHaveLength(3);
    expect(container.querySelector(sentinelSelector)).toBeInTheDocument();
    expect(observers[0]?.observe).toHaveBeenCalledWith(container.querySelector(sentinelSelector));

    act(() => observers[observers.length - 1].notify(false));
    expect(container.querySelectorAll(".list-item")).toHaveLength(3);
    act(() => observers[observers.length - 1].notify(true));
    expect(container.querySelectorAll(".list-item")).toHaveLength(9);
    act(() => observers[observers.length - 1].notify(true));

    for (const client of clients) expect(screen.getByText(client.name)).toBeInTheDocument();
    expect(container.querySelectorAll(".list-item")).toHaveLength(15);
    expect(container.querySelector(sentinelSelector)).not.toBeInTheDocument();
  } finally {
    cleanup();
    jest.restoreAllMocks();
    for (const [name, descriptor] of [
      ["IntersectionObserver", originalIntersection],
      ["ResizeObserver", originalResize],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

describe("due labels on the branch calendar", () => {
  const mockedCalendarHook = jest.mocked(useBusinessDayCalendar);
  const calendarResult = (calendar: typeof KR_BUILTIN_CALENDAR) => ({
    calendar,
    ready: true,
    error: null,
    retry: jest.fn(),
    refreshForSave: async () => ({ ok: true as const, calendar, changed: false }),
    version: calendar.version,
  });

  afterEach(() => {
    mockedCalendarHook.mockReturnValue(calendarResult(KR_BUILTIN_CALENDAR));
  });

  it("counts a branch-added holiday as a non-business day in the start countdown", () => {
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: /시작 예정/ }));
    expect(screen.getAllByText("서비스 시작 2 영업일 남음").length).toBeGreaterThan(0);

    // The branch is closed Thursday 2026-06-11, between "now" (06-10) and the start (06-12).
    mockedCalendarHook.mockReturnValue(
      calendarResult(
        createKrBusinessDayCalendar([...getKoreanHolidays(2026), "2026-06-11"], {
          version: "kr-db-branch",
          supportedYears: [2026],
        }),
      ),
    );
    cleanup();
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: /시작 예정/ }));

    expect(screen.queryByText("서비스 시작 2 영업일 남음")).not.toBeInTheDocument();
    expect(screen.getAllByText("서비스 시작 1 영업일 남음").length).toBeGreaterThan(0);
  });
});

describe("summary cards", () => {
  const statCards = () =>
    Object.fromEntries(
      Array.from(document.querySelectorAll('[data-slot="stat-mini"]')).map((card) => {
        const text = card.textContent ?? "";
        const label = ["서비스 진행 중", "7일 내 시작 예정", "검토 필요 문서", "계약서 발송 필요", "계약서 미완료"].find(
          (candidate) => text.includes(candidate),
        );
        return [label ?? text, text.replace(label ?? "", "").trim()];
      }),
    );

  const withAnalytics = (data: Record<string, number | null>) =>
    analyticsQuery.mockReturnValue({
      data,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useDashboardAnalytics>);

  it("shows the seven-day start count under the seven-day label and the server 발송 필요 count under its own label", () => {
    withAnalytics({
      activeClients: 5,
      contractsNotSent: 4,
      contractsPendingSignature: 2,
      upcomingThisMonth: 40,
      upcomingNextMonth: 1,
      upcomingWithinWeek: 2,
    });

    render(<DashboardPage />);

    // 40 is the backend's month-wide count; it must never appear under the 7-day label.
    expect(statCards()).toEqual({
      "서비스 진행 중": "5",
      "7일 내 시작 예정": "2",
      "검토 필요 문서": "2",
      "계약서 발송 필요": "4",
    });
  });

  it("shows a dash for server-decided counts that are unknown instead of a guessed zero", () => {
    withAnalytics({
      activeClients: 5,
      contractsNotSent: null,
      contractsPendingSignature: null,
      upcomingThisMonth: null,
      upcomingNextMonth: null,
      upcomingWithinWeek: 2,
    });

    render(<DashboardPage />);

    expect(statCards()).toEqual({
      "서비스 진행 중": "5",
      "7일 내 시작 예정": "2",
      "검토 필요 문서": "-",
      "계약서 발송 필요": "-",
    });
  });

  it("still shows a real zero as 0", () => {
    withAnalytics({
      activeClients: 0,
      contractsNotSent: 0,
      contractsPendingSignature: 0,
      upcomingThisMonth: 0,
      upcomingNextMonth: 0,
      upcomingWithinWeek: 0,
    });

    render(<DashboardPage />);

    expect(statCards()).toEqual({
      "서비스 진행 중": "0",
      "7일 내 시작 예정": "0",
      "검토 필요 문서": "0",
      "계약서 발송 필요": "0",
    });
  });
});
