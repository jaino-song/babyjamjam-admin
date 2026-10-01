import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import type { UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import {
  createKrBusinessDayCalendar,
  KR_BUILTIN_CALENDAR,
  KR_BUILTIN_HOLIDAYS,
} from "@/lib/date/business-days";
import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));
jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { phone: "010-1234-5678" } }),
}));
jest.mock("@/hooks/useEformsign", () => ({
  useEformsign: () => ({ isLoaded: true, isLoading: false, error: null, openDocument: jest.fn() }),
}));
jest.mock("@/services/api", () => ({
  eformsignApi: {
    dispatchHeadless: jest.fn(),
    generateDocument: jest.fn(),
    createDocRecord: jest.fn().mockResolvedValue({}),
    adoptDocument: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => flag === "headlessDispatch",
}));
jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAllClients: () => ({ data: [], isLoading: false }),
}));
jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false }),
}));
jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [2024, 2026], isLoading: false }),
  useAreaTemplates: () => ({
    data: [{ id: "area-template-1", areaId: "인천", templateId: "template-1", templateName: "인천 산모 계약서" }],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CONTRACT_INFO_STEP_INDEX = 3;
const mockedHook = useBusinessDayCalendar as jest.MockedFunction<typeof useBusinessDayCalendar>;

// 2026-11-03 (Tue) is a normal weekday in the built-in list; the branch adds it as a holiday.
const BRANCH_CALENDAR = createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-11-03"], {
  version: "kr-db-test-branch",
  supportedYears: [2024, 2025, 2026, 2027],
});

function hookResult(overrides: Partial<UseBusinessDayCalendarResult> = {}): UseBusinessDayCalendarResult {
  const calendar = overrides.calendar ?? KR_BUILTIN_CALENDAR;
  return { calendar, ready: true, error: null, retry: jest.fn(), version: calendar.version, ...overrides };
}

function seedStore(overrides: { startDate: string; endDate?: string; voucherDuration: string }): void {
  useFormStore.setState({
    clientId: 42,
    name: "송진호",
    phone: "010-6621-1878",
    birthday: "960414",
    dueDate: "",
    birthDate: "",
    address: "인천시",
    employeeId: 7,
    employeeName: "김정인",
    employeePhone: "01057871878",
    showEmployee2: false,
    employee2Id: null,
    startDate: overrides.startDate,
    endDate: overrides.endDate ?? "",
    paymentDate: "2026-09-18",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    voucherType: "일반",
    voucherDuration: overrides.voucherDuration,
    area: "인천",
  });
}

function buildUi() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm activeStep={CONTRACT_INFO_STEP_INDEX} onActiveStepChange={jest.fn()} />
    </QueryClientProvider>
  );
}

function lastExtraYears(): number[] {
  const calls = mockedHook.mock.calls as unknown as Array<[{ extraYears?: number[] } | undefined]>;
  return calls[calls.length - 1]?.[0]?.extraYears ?? [];
}

describe("ContractCreationForm — branch business-day calendar", () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    }
    global.ResizeObserver = ResizeObserverMock;
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useFormStore.getState().resetAll();
    mockedHook.mockImplementation(() => hookResult());
  });

  it("counts a branch-added holiday inside the period when computing the end date", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));

    render(buildUi());

    // 11-02, (11-03 is a branch holiday), 11-04, 11-05
    expect(useFormStore.getState().endDate).toBe("2026-11-05");
    expect(screen.getByLabelText("계약 종료일")).toHaveValue("2026-11-05");
  });

  it("uses the built-in result when the branch has no extra holiday", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });

    render(buildUi());

    expect(useFormStore.getState().endDate).toBe("2026-11-04");
  });

  it("does not compute while the calendar loads, then computes once when it becomes ready", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    mockedHook.mockImplementation(() => hookResult({ ready: false }));

    const { rerender } = render(buildUi());
    expect(useFormStore.getState().endDate).toBe("");

    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    rerender(buildUi());
    expect(useFormStore.getState().endDate).toBe("2026-11-05");
  });

  it("keeps a manually edited end date across a not-ready to ready flip", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    const { rerender } = render(buildUi());
    expect(useFormStore.getState().endDate).toBe("2026-11-04");

    fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: "2026-12-31" } });
    expect(useFormStore.getState().endDate).toBe("2026-12-31");

    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    rerender(buildUi());
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    rerender(buildUi());

    expect(useFormStore.getState().endDate).toBe("2026-12-31");
    expect(screen.getByLabelText("계약 종료일")).toHaveValue("2026-12-31");
  });

  it("does not overwrite an end date typed while the calendar was still loading", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    const { rerender } = render(buildUi());

    fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: "2026-12-31" } });
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    rerender(buildUi());

    expect(useFormStore.getState().endDate).toBe("2026-12-31");
  });

  it("does not recompute when only the calendar object changes", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    const { rerender } = render(buildUi());
    fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: "2026-12-31" } });

    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    rerender(buildUi());

    expect(useFormStore.getState().endDate).toBe("2026-12-31");
  });

  it("disables submit and shows the loading notice until the calendar is ready", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    const { rerender } = render(buildUi());

    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toBeInTheDocument();

    mockedHook.mockImplementation(() => hookResult());
    rerender(buildUi());

    expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled();
    expect(screen.queryByText("공휴일 정보를 불러오는 중이에요…")).not.toBeInTheDocument();
  });

  it("shows the retry notice when the calendar fails to load and retries on click", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    const retry = jest.fn();
    mockedHook.mockImplementation(() => hookResult({ ready: false, error: "load-failed", retry }));

    render(buildUi());

    expect(screen.getByText("공휴일 정보를 불러오지 못했어요.")).toBeInTheDocument();
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the no-branch notice and keeps submit disabled", () => {
    seedStore({ startDate: "2026-11-02", voucherDuration: "3" });
    mockedHook.mockImplementation(() => hookResult({ ready: false, error: "no-branch" }));

    render(buildUi());

    expect(screen.getByText("지점을 선택한 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
  });

  it("asks for the years of an old (2024) contract and computes its end date", () => {
    seedStore({ startDate: "2024-03-04", voucherDuration: "3" });

    render(buildUi());

    expect(lastExtraYears()).toEqual(expect.arrayContaining([2024, 2025]));
    // 03-04, 03-05, 03-06 (no holidays in that week)
    expect(useFormStore.getState().endDate).toBe("2024-03-06");
  });

  it("requests the end-date year as well when the end date lies in another year", () => {
    seedStore({ startDate: "2026-11-02", endDate: "2029-01-15", voucherDuration: "" });

    render(buildUi());

    expect(lastExtraYears()).toEqual(expect.arrayContaining([2026, 2027, 2029]));
  });
});
