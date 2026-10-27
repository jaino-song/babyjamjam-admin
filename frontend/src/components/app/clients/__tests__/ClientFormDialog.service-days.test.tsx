import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";

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

const baseClient: Client = {
  id: 92,
  name: "서비스일 고객",
  createdAt: "2026-10-01",
  birthday: "1990-01-01",
  dueDate: "2026-10-20",
  birthDate: null,
  address: "인천시 남동구",
  phone: "01012345678",
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: 10,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: "2026-12-14",
  endDate: "2026-12-28",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  bookingConfirmedAt: null,
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const CREATE_PREFILL = {
  name: "서비스일 신규",
  birthday: "900101",
  dueDate: "2026-12-10",
  address: "인천시",
  phone: "01012345678",
  voucherClient: false,
  applyMessageAutomation: false,
  duration: 10,
  startDate: "2026-12-14",
};

const switchOf = (name: string) => screen.getByRole("switch", { name });

describe("ClientFormDialog 주말·공휴일 서비스 switches", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue(baseClient);
    mockedHook.mockReset();
    mockedHook.mockImplementation(() => ({
      calendar: KR_BUILTIN_CALENDAR,
      ready: true,
      error: null,
      retry: jest.fn(),
      refreshForSave: async () => ({ ok: true, calendar: KR_BUILTIN_CALENDAR, changed: false }),
      version: KR_BUILTIN_CALENDAR.version,
    }));
  });

  it("renders the group row with three switches, all off by default", async () => {
    render(<ClientFormDialog open prefill={CREATE_PREFILL} onClose={jest.fn()} />);
    await screen.findByText("등록 가능한 번호입니다.");

    const row = document.querySelector('[data-source-component="FormSwitchGroupRow"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(within(row).getByText("주말·공휴일 서비스")).toBeInTheDocument();
    for (const name of ["토요일", "일요일", "공휴일"]) {
      expect(within(row).getByRole("switch", { name })).not.toBeChecked();
    }
  });

  it("create mode: end date follows the Saturday switch and returns when it is switched off", async () => {
    render(<ClientFormDialog open prefill={CREATE_PREFILL} onClose={jest.fn()} />);
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-28"));

    fireEvent.click(switchOf("토요일"));
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-24"));
    expect(switchOf("토요일")).toBeChecked();

    fireEvent.click(switchOf("토요일"));
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-28"));
  });

  it("create mode: a manually typed end date wins over a toggle", async () => {
    render(<ClientFormDialog open prefill={CREATE_PREFILL} onClose={jest.fn()} />);
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-28"));

    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-12-30" } });
    fireEvent.click(switchOf("토요일"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-30");
  });

  it("create mode: sends all three flags and the service-day end date", async () => {
    render(<ClientFormDialog open prefill={CREATE_PREFILL} onClose={jest.fn()} />);
    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-28"));

    fireEvent.click(switchOf("토요일"));
    fireEvent.click(switchOf("일요일"));
    // 12-14..12-18 (5), Sat 12-19 (6), Sun 12-20 (7), 12-21..12-23 (10)
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-23"));
    fireEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    const dto = mockCreateClient.mock.calls[0][0];
    expect(dto).toMatchObject({
      allowSaturdayService: true,
      allowSundayService: true,
      allowHolidayService: false,
      endDate: "2026-12-23",
    });
  });

  it("edit mode: loads a stored Saturday flag as on and leaves the other switches off", async () => {
    render(<ClientFormDialog open client={{ ...baseClient, allowSaturdayService: true }} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue(baseClient.name));

    expect(switchOf("토요일")).toBeChecked();
    expect(switchOf("일요일")).not.toBeChecked();
    expect(switchOf("공휴일")).not.toBeChecked();
  });

  it("edit mode: toggling does not recompute the stored end date and sends only the changed flag", async () => {
    render(<ClientFormDialog open client={baseClient} onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue(baseClient.name));
    await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());

    fireEvent.click(switchOf("일요일"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByLabelText("종료일")).toHaveValue("2026-12-28");

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient.mock.calls[0][0].dto).toEqual({ allowSundayService: true });
  });
});
