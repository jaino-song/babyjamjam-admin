import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import type { UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import {
  createKrBusinessDayCalendar,
  KR_BUILTIN_CALENDAR,
  KR_BUILTIN_HOLIDAYS,
} from "@/lib/date/business-days";

import { ClientFormDialog } from "../ClientFormDialog";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));
jest.mock("@/hooks/useVoucherData", () => ({
  useAvailableClientAreas: () => ({ data: [], isLoading: false }),
  useAreaTemplates: () => ({ data: [], isLoading: false }),
  useOutOfPocketPriceInfos: () => ({ data: [], isError: false, isLoading: false }),
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [], isLoading: false }),
}));
jest.mock("@/stores/client-dialog-store", () => {
  const state = { prefillName: "", clearPrefillName: jest.fn() };
  return {
    useClientDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});
jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));
jest.mock("../EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => <div data-testid="employee-autocomplete" />,
}));
jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));
jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;
const mockedHook = useBusinessDayCalendar as jest.MockedFunction<typeof useBusinessDayCalendar>;

// 2026-11-03 (Tue) is a normal weekday in the built-in list; the branch adds it as a holiday.
const BRANCH_CALENDAR = createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-11-03"], {
  version: "kr-db-test-branch",
  supportedYears: [2024, 2025, 2026, 2027],
});

// A calendar that has not been synced for 2028 yet: any calculation reaching it throws.
const UNSUPPORTED_2028_CALENDAR = createKrBusinessDayCalendar(KR_BUILTIN_HOLIDAYS, {
  version: "kr-db-test-unsupported-2028",
  supportedYears: [2026, 2027],
});
const UNSUPPORTED_YEAR_NOTICE = "이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요.";

function hookResult(overrides: Partial<UseBusinessDayCalendarResult> = {}): UseBusinessDayCalendarResult {
  const calendar = overrides.calendar ?? KR_BUILTIN_CALENDAR;
  return { calendar, ready: true, error: null, retry: jest.fn(), refreshForSave: async () => ({ ok: true, calendar, changed: false }), version: calendar.version, ...overrides };
}

const basePrefill = {
  name: "달력 테스트",
  birthday: "900101",
  dueDate: "2026-11-01",
  address: "인천시",
  phone: "01012345678",
  voucherClient: false,
  applyMessageAutomation: false,
};
const NOV_PREFILL = { ...basePrefill, duration: 3, startDate: "2026-11-02" };
const OLD_PREFILL = { ...basePrefill, duration: 3, startDate: "2024-03-04" };
const MISMATCH_PREFILL = { ...basePrefill, duration: 3, startDate: "2026-11-02", endDate: "2026-11-04" };

function lastExtraYears(): number[] {
  const calls = mockedHook.mock.calls as unknown as Array<[{ extraYears?: number[] } | undefined]>;
  return calls[calls.length - 1]?.[0]?.extraYears ?? [];
}

const LATE_2027_PREFILL = { ...basePrefill, duration: 40, startDate: "2027-11-01" };

function ui(prefill: typeof NOV_PREFILL | typeof MISMATCH_PREFILL) {
  return <ClientFormDialog open onClose={jest.fn()} prefill={prefill} />;
}

describe("ClientFormDialog — branch business-day calendar", () => {
  it.each([true, false])("recalculates auto dates before save even when refresh changed is %s", async (changed) => {
    const refreshForSave = jest.fn().mockResolvedValue({ ok: true, calendar: BRANCH_CALENDAR, changed });
    mockedHook.mockImplementation(() => hookResult({ refreshForSave }));
    render(ui(NOV_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-04"));
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    await screen.findByText("공휴일 정보가 바뀌어 날짜를 다시 계산했어요. 확인 후 다시 저장해 주세요.");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-05");
    expect(mockCreateClient).not.toHaveBeenCalled();
    refreshForSave.mockResolvedValue({ ok: true, calendar: BRANCH_CALENDAR, changed: false });
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient.mock.calls[0][0].endDate).toBe("2026-11-05");
  });

  it("does not save on refresh failure and uses the existing load-failed notice", async () => {
    mockedHook.mockImplementation(() => hookResult({ refreshForSave: async () => ({ ok: false }) }));
    render(ui(NOV_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    await screen.findByText("공휴일 정보를 불러오지 못했어요.");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("does not overwrite a manually typed end date on refresh", async () => {
    mockedHook.mockImplementation(() => hookResult({ refreshForSave: async () => ({ ok: true, calendar: BRANCH_CALENDAR, changed: true }) }));
    render(ui(NOV_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    await screen.findByText("공휴일 정보가 바뀌어 날짜를 다시 계산했어요. 확인 후 다시 저장해 주세요.");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-31");
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue({ id: 2 });
    mockedHook.mockReset();
    mockedHook.mockImplementation(() => hookResult());
  });

  it("counts a branch-added holiday inside the period when computing the end date", async () => {
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    render(ui(NOV_PREFILL));

    // 11-02, (11-03 is a branch holiday), 11-04, 11-05
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-05"));
  });

  it("computes the built-in end date when the branch has no extra holiday", async () => {
    render(ui(NOV_PREFILL));

    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-04"));
  });

  it("waits for the calendar before computing, then computes once when it is ready", async () => {
    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    const { rerender } = render(ui(NOV_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    expect(screen.getByLabelText("종료일")).toHaveValue("");

    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    rerender(ui(NOV_PREFILL));
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-05"));
  });

  it("keeps a manually edited end date across a not-ready to ready flip", async () => {
    const { rerender } = render(ui(NOV_PREFILL));
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-04"));

    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-12-31" } });
    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    rerender(ui(NOV_PREFILL));
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    rerender(ui(NOV_PREFILL));

    await screen.findByText("등록 가능한 번호입니다.");
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-31");
  });

  it("does not overwrite an end date typed while the calendar was still loading", async () => {
    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    const { rerender } = render(ui(NOV_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");

    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-12-31" } });
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    rerender(ui(NOV_PREFILL));

    expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-31");
  });

  it("disables submit and shows the loading notice until the calendar is ready", async () => {
    mockedHook.mockImplementation(() => hookResult({ ready: false }));
    const { rerender } = render(ui(NOV_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");

    expect(screen.getByRole("button", { name: "생성" })).toBeDisabled();
    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toBeInTheDocument();

    mockedHook.mockImplementation(() => hookResult());
    rerender(ui(NOV_PREFILL));
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    expect(screen.queryByText("공휴일 정보를 불러오는 중이에요…")).not.toBeInTheDocument();
  });

  it("shows the no-branch notice and keeps submit disabled", async () => {
    mockedHook.mockImplementation(() => hookResult({ ready: false, error: "no-branch" }));
    render(ui(NOV_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");

    expect(screen.getByText("지점을 선택한 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생성" })).toBeDisabled();
  });

  it("shows a retry button when the calendar fails to load", async () => {
    const retry = jest.fn();
    mockedHook.mockImplementation(() => hookResult({ ready: false, error: "load-failed", retry }));
    render(ui(NOV_PREFILL));

    fireEvent.click(await screen.findByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("checks the saved period against the branch calendar", async () => {
    // Built-in: 11-02..11-04 is 3 weekdays = duration 3, so it saves directly.
    const { unmount } = render(ui(MISMATCH_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
    unmount();

    // Branch holiday on 11-03 leaves only 2 business days, so the period needs confirmation.
    mockCreateClient.mockClear();
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    render(ui(MISMATCH_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(within(modal).getByRole("button", { name: "확인" })).toBeVisible();
  });

  it("asks for the years of an old (2024) client and computes its end date", async () => {
    render(<ClientFormDialog open onClose={jest.fn()} prefill={OLD_PREFILL} />);

    // 03-04, 03-05, 03-06 (no holidays in that week)
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2024-03-06"));
    expect(lastExtraYears()).toEqual(expect.arrayContaining([2024, 2025]));
  });

  it("clears the stale end date, shows the notice and blocks submit for a year the calendar does not support", async () => {
    mockedHook.mockImplementation(() => hookResult({ calendar: UNSUPPORTED_2028_CALENDAR }));
    render(<ClientFormDialog open onClose={jest.fn()} prefill={LATE_2027_PREFILL} />);
    await screen.findByText("등록 가능한 번호입니다.");
    // 40 business days from 2027-11-01 stay inside 2027.
    await waitFor(() => expect(screen.getByLabelText("종료일")).not.toHaveValue(""));
    expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();

    // From 2027-12-15 the same 40 days reach 2028.
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2027-12-15" } });

    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue(""));
    expect(screen.getByText(UNSUPPORTED_YEAR_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생성" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2027-11-01" } });

    await waitFor(() => expect(screen.getByLabelText("종료일")).not.toHaveValue(""));
    expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생성" })).toBeEnabled();
  });

  it("drops the unsupported-year notice once the user types an end date", async () => {
    mockedHook.mockImplementation(() => hookResult({ calendar: UNSUPPORTED_2028_CALENDAR }));
    render(<ClientFormDialog open onClose={jest.fn()} prefill={{ ...LATE_2027_PREFILL, startDate: "2027-12-15" }} />);
    await screen.findByText(UNSUPPORTED_YEAR_NOTICE);
    expect(screen.getByLabelText("종료일")).toHaveValue("");

    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2028-02-15" } });

    expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
  });

  it("refuses to save from the duration confirmation once the calendar is no longer ready", async () => {
    // Branch holiday on 11-03 leaves only 2 business days, so saving asks for confirmation.
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    const { rerender } = render(ui(MISMATCH_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });

    // The calendar becomes unavailable while the confirmation is open. The confirm button is
    // not gated by the calendar, so only the handler guard stands between it and a save.
    mockedHook.mockImplementation(() => hookResult({ ready: false, error: "load-failed" }));
    rerender(ui(MISMATCH_PREFILL));
    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("saves from the same confirmation while the calendar stays ready", async () => {
    mockedHook.mockImplementation(() => hookResult({ calendar: BRANCH_CALENDAR }));
    render(ui(MISMATCH_PREFILL));
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });

    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
  });
});
