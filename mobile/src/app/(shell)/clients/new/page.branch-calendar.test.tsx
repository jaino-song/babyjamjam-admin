import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import type { UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import {
  createKrBusinessDayCalendar,
  getKoreanHolidays,
  KR_BUILTIN_CALENDAR,
} from "@/lib/date/business-days";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();
const mockPush = jest.fn();
const mockEmptyPrices: never[] = [];
const mockOutOfPocketPrices = [{ id: 1, duration: 15, fullPrice: "1" }];

jest.mock("@/hooks/useBusinessDayCalendar");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
}));

jest.mock("@/hooks/useClients", () => ({
  useClient: () => ({ data: undefined }),
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAllVoucherPrices: () => ({ data: mockEmptyPrices, isLoading: false, isFetching: false }),
  useOutOfPocketPriceInfos: () => ({
    data: mockOutOfPocketPrices,
    isLoading: false,
    isError: false,
  }),
  useVoucherPriceInfos: () => ({ data: mockEmptyPrices, isLoading: false }),
  useVoucherYears: () => ({ data: mockEmptyPrices }),
}));

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => null,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/lib/i18n/translations", () => ({
  t: (_locale: string, key: string) => key,
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

jest.mock("@/lib/errors/api-error-mapper", () => ({
  getErrorMessage: () => "save failed",
}));

jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn() },
}));

jest.mock("@/lib/eformsign/client-prefill", () => ({
  buildClientEditPrefillFromEformsignDocument: () => ({}),
}));

const mockedCalendarHook = jest.mocked(useBusinessDayCalendar);

// The branch closes Thursday 2026-09-10 on top of the public holidays.
const BRANCH_CALENDAR = createKrBusinessDayCalendar([...getKoreanHolidays(2026), "2026-09-10"], {
  version: "kr-db-branch",
  supportedYears: [2026],
});
// Same days, different object and version: what a refetch after a branch edit produces.
const BRANCH_CALENDAR_REFETCHED = createKrBusinessDayCalendar([...getKoreanHolidays(2026), "2026-09-10"], {
  version: "kr-db-branch-2",
  supportedYears: [2026],
});

// A calendar that has not been synced for 2028 yet: any calculation reaching it throws.
const UNSUPPORTED_2028_CALENDAR = createKrBusinessDayCalendar(getKoreanHolidays(2027), {
  version: "kr-db-unsupported-2028",
  supportedYears: [2026, 2027],
});
const UNSUPPORTED_YEAR_NOTICE = "이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요.";

function calendarResult(overrides: Partial<UseBusinessDayCalendarResult>): UseBusinessDayCalendarResult {
  const calendar = overrides.calendar ?? KR_BUILTIN_CALENDAR;
  return {
    calendar,
    ready: true,
    error: null,
    retry: jest.fn(),
    version: calendar.version,
    ...overrides,
  };
}

const initialForm = {
  name: "지점 캘린더 고객",
  birthday: "1958-03-03",
  dueDate: "2026-08-01",
  birthDate: "",
  address: "인천시",
  phone: "",
  primaryEmployeeId: null,
  secondaryEmployeeId: null,
  type: "",
  duration: 15,
  fullPrice: "1",
  grant: "0",
  actualPrice: "1",
  startDate: "2026-09-03",
  endDate: "2026-09-24",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking" as const,
  areaId: "",
  currentStep: 2,
  pricesManuallyEdited: false,
  voucherYear: null,
};

function renderCreate() {
  const view = render(<NewClientPage />);
  act(() => {
    useClientWizardStore.setState(initialForm);
  });
  return view;
}

// Calls the element's React onClick directly, so the test reaches the handler even though the
// (disabled) button would swallow a real click.
function invokeReactClick(element: HTMLElement): void {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  const onClick = (element as unknown as Record<string, { onClick?: () => void }>)[propsKey ?? ""]?.onClick;
  if (!onClick) throw new Error("element has no React onClick");
  act(() => onClick());
}

const publicEnd = (start: string) => KR_BUILTIN_CALENDAR.calcEndDateBusinessDays(start, 15);
const branchEnd = (start: string) => BRANCH_CALENDAR.calcEndDateBusinessDays(start, 15);

describe("mobile client wizard on the branch holiday calendar", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockPush.mockReset();
    mockedCalendarHook.mockReset();
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: BRANCH_CALENDAR }));
    act(() => useClientDialogStore.getState().reset());
    useClientWizardStore.getState().reset();
  });

  it("moves the calculated end date by the branch-added holiday", async () => {
    renderCreate();

    fireEvent.change(screen.getByDisplayValue("2026-09-03"), { target: { value: "2026-09-04" } });

    const expected = branchEnd("2026-09-04");
    expect(expected).not.toBe(publicEnd("2026-09-04"));
    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe(expected));
  });

  it("does not calculate the end date until the calendar is ready, then calculates once", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ ready: false, calendar: KR_BUILTIN_CALENDAR }));
    const view = renderCreate();

    fireEvent.change(screen.getByDisplayValue("2026-09-03"), { target: { value: "2026-09-04" } });
    expect(useClientWizardStore.getState().endDate).toBe("2026-09-24");

    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: BRANCH_CALENDAR }));
    view.rerender(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe(branchEnd("2026-09-04")));
  });

  it("keeps a manual end date when the calendar reloads without the dates changing", async () => {
    const view = renderCreate();
    fireEvent.change(screen.getByDisplayValue("2026-09-03"), { target: { value: "2026-09-04" } });
    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe(branchEnd("2026-09-04")));

    fireEvent.change(screen.getByDisplayValue(branchEnd("2026-09-04")), { target: { value: "2026-10-01" } });
    expect(useClientWizardStore.getState().endDate).toBe("2026-10-01");

    mockedCalendarHook.mockReturnValue(calendarResult({ ready: false, calendar: BRANCH_CALENDAR }));
    view.rerender(<NewClientPage />);
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: BRANCH_CALENDAR_REFETCHED }));
    view.rerender(<NewClientPage />);

    expect(useClientWizardStore.getState().endDate).toBe("2026-10-01");
    expect(screen.getByDisplayValue("2026-10-01")).toBeInTheDocument();
  });

  it("keeps the register button disabled and does not save while the calendar is loading", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ ready: false, calendar: KR_BUILTIN_CALENDAR }));
    const view = renderCreate();

    const button = screen.getByRole("button", { name: "등록" });
    expect(button).toBeDisabled();
    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toBeInTheDocument();
    fireEvent.click(button);
    expect(mockCreateClient).not.toHaveBeenCalled();

    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: BRANCH_CALENDAR }));
    view.rerender(<NewClientPage />);
    expect(screen.getByRole("button", { name: "등록" })).toBeEnabled();
  });

  it("shows the no-branch notice and blocks saving", () => {
    mockedCalendarHook.mockReturnValue(
      calendarResult({ ready: false, error: "no-branch", calendar: KR_BUILTIN_CALENDAR }),
    );
    renderCreate();

    expect(screen.getByText("지점을 선택한 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "등록" })).toBeDisabled();
  });

  it("asks for a duration confirmation when a branch holiday makes the period one day short", async () => {
    // 2026-09-03..2026-09-24 holds 15 public business days; the branch closure makes it 14.
    expect(KR_BUILTIN_CALENDAR.countBusinessDays("2026-09-03", "2026-09-23")).toBe(15);
    render(<NewClientPage />);
    act(() => {
      useClientWizardStore.setState({ ...initialForm, endDate: "2026-09-23" });
    });

    fireEvent.click(screen.getByRole("button", { name: "등록" }));

    expect(await screen.findByRole("dialog", { name: "서비스 기간 확인" })).toBeInTheDocument();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("asks the calendar hook for the years of the dates the form already holds", () => {
    render(<NewClientPage />);
    act(() => {
      useClientWizardStore.setState({ ...initialForm, startDate: "2024-12-20", endDate: "2025-01-10" });
    });

    const lastCall = mockedCalendarHook.mock.calls.at(-1)?.[0];
    expect(lastCall?.extraYears).toEqual(expect.arrayContaining([2024, 2025]));
  });

  it("clears the stale end date, shows the notice and blocks saving for a year the calendar does not support", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: UNSUPPORTED_2028_CALENDAR }));
    renderCreate();
    act(() => {
      useClientWizardStore.setState({ startDate: "2027-11-01", endDate: "2027-11-19" });
    });

    // 15 business days from 2027-12-15 reach 2028.
    fireEvent.change(screen.getByDisplayValue("2027-11-01"), { target: { value: "2027-12-15" } });

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe(""));
    expect(screen.getByText(UNSUPPORTED_YEAR_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "등록" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    expect(mockCreateClient).not.toHaveBeenCalled();

    fireEvent.change(screen.getByDisplayValue("2027-12-15"), { target: { value: "2027-11-01" } });

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe("2027-11-19"));
    expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "등록" })).toBeEnabled();
  });

  it("drops the unsupported-year notice once the user types an end date", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: UNSUPPORTED_2028_CALENDAR }));
    renderCreate();
    act(() => {
      useClientWizardStore.setState({ startDate: "2027-11-01", endDate: "2027-11-19" });
    });
    fireEvent.change(screen.getByDisplayValue("2027-11-01"), { target: { value: "2027-12-15" } });
    await screen.findByText(UNSUPPORTED_YEAR_NOTICE);

    fireEvent.change(screen.getByPlaceholderText("2026-12-19"), { target: { value: "2028-01-12" } });

    expect(useClientWizardStore.getState().endDate).toBe("2028-01-12");
    expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "등록" })).toBeEnabled();
  });

  it("keeps the submit handler itself closed for an unsupported year, even with an end date present", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: UNSUPPORTED_2028_CALENDAR }));
    renderCreate();
    act(() => {
      useClientWizardStore.setState({ startDate: "2027-11-01", endDate: "2027-11-19" });
    });
    fireEvent.change(screen.getByDisplayValue("2027-11-01"), { target: { value: "2027-12-15" } });
    await screen.findByText(UNSUPPORTED_YEAR_NOTICE);
    // A complete end date that did not come from the end-date input keeps the unsupported flag set.
    act(() => {
      useClientWizardStore.setState({ endDate: "2028-01-12" });
    });
    const register = screen.getByRole("button", { name: "등록" });
    expect(register).toBeDisabled();

    // The button is disabled, so a real click never reaches the handler; call it directly.
    invokeReactClick(register);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
  });
});
