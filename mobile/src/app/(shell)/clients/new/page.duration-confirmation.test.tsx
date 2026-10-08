import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import type { UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import type { Client } from "@/lib/client/types";
import { KR_BUILTIN_CALENDAR, calcEndDateBusinessDays } from "@/lib/date/business-days";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockEditingClient: Client | undefined;
let mockEditingContractDocument: object | undefined;
let mockLatePrefill: Record<string, unknown> = {};
let mockEmployees: Array<{
  id: number;
  name: string;
  phone: string;
  openToNextWork?: boolean;
}> = [];
const mockedCalendarHook = useBusinessDayCalendar as jest.MockedFunction<typeof useBusinessDayCalendar>;
const defaultCalendarHook = mockedCalendarHook.getMockImplementation();
const mockOutOfPocketPrices = [{ id: 1, duration: 15, fullPrice: "1" }];
const mockEmptyPrices: never[] = [];

jest.mock("@/hooks/useBusinessDayCalendar");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockEditingContractDocument }),
}));

jest.mock("@/hooks/useClients", () => ({
  useClient: () => ({ data: mockEditingClient }),
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: mockEmployees, isLoading: false, refetch: jest.fn() }),
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
  buildClientEditPrefillFromEformsignDocument: () => mockLatePrefill,
}));

const initialForm = {
  name: "기간 확인 고객",
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
  endDate: "2026-09-08",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking" as const,
  areaId: "",
  currentStep: 2,
  pricesManuallyEdited: false,
  voucherYear: null,
};

function seedForm() {
  act(() => {
    useClientWizardStore.setState(initialForm);
  });
}

function renderCreate() {
  mockSearchParams = new URLSearchParams();
  mockEditingClient = undefined;
  render(<NewClientPage />);
  seedForm();
}

function editingClient(): Client {
  return {
    id: 7,
    name: initialForm.name,
    birthday: initialForm.birthday,
    dueDate: initialForm.dueDate,
    birthDate: null,
    address: initialForm.address,
    phone: null,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: initialForm.duration,
    fullPrice: initialForm.fullPrice,
    grant: initialForm.grant,
    actualPrice: initialForm.actualPrice,
    startDate: initialForm.startDate,
    endDate: initialForm.endDate,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "pre_booking",
    eDocId: null,
    areaId: null,
    hasSigned: false,
    documentStatus: null,
  };
}

describe("mobile client service date confirmation", () => {
  beforeEach(() => {
    mockedCalendarHook.mockReset();
    if (defaultCalendarHook) mockedCalendarHook.mockImplementation(defaultCalendarHook);
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue({ id: 7 });
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
    mockEditingClient = undefined;
    mockEditingContractDocument = undefined;
    mockLatePrefill = {};
    mockEmployees = [];
    act(() => useClientDialogStore.getState().reset());
    useClientWizardStore.getState().reset();
  });

  it("keeps the entered period on cancel and sends the mismatch flag only after confirmation", async () => {
    renderCreate();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });

    expect(mockCreateClient).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-09-03")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-09-08")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "서비스 기간 확인" })).getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      duration: 15,
      startDate: "2026-09-03",
      endDate: "2026-09-08",
      allowBusinessDayMismatch: true,
    }));
  });

  it.each([
    ["the holiday calendar changed", { ok: true, calendar: KR_BUILTIN_CALENDAR, changed: true }, "공휴일 정보가 바뀌어 날짜를 다시 계산했어요. 확인 후 다시 저장해 주세요."],
    ["the holiday calendar could not be refreshed", { ok: false }, "공휴일 정보를 불러오지 못했어요."],
  ] as const)("closes the duration dialog and shows the notice when %s on confirm", async (_label, blockedRefresh, notice) => {
    const refreshForSave = jest.fn<ReturnType<UseBusinessDayCalendarResult["refreshForSave"]>, []>()
      .mockResolvedValueOnce({ ok: true, calendar: KR_BUILTIN_CALENDAR, changed: false })
      .mockResolvedValue(blockedRefresh);
    mockedCalendarHook.mockReturnValue({
      calendar: KR_BUILTIN_CALENDAR,
      ready: true,
      error: null,
      retry: jest.fn(),
      refreshForSave,
      version: KR_BUILTIN_CALENDAR.version,
    });
    renderCreate();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

    await waitFor(() => expect(refreshForSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument());
    expect(screen.getByText(notice)).toBeInTheDocument();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  describe("when the calendar stops being ready while a confirmation is open", () => {
    const notReadyCalendar: UseBusinessDayCalendarResult = {
      calendar: KR_BUILTIN_CALENDAR,
      ready: false,
      error: "load-failed",
      retry: jest.fn(),
      refreshForSave: jest.fn(),
      version: KR_BUILTIN_CALENDAR.version,
    };

    function makeCalendarFail() {
      mockedCalendarHook.mockReturnValue(notReadyCalendar);
      // Any store change re-renders the page so it picks up the failed calendar.
      act(() => {
        useClientWizardStore.getState().setField("address", "인천시 연수구");
      });
    }

    it("closes the duration dialog on confirm without saving", async () => {
      renderCreate();

      fireEvent.click(screen.getByRole("button", { name: "등록" }));
      const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });

      makeCalendarFail();
      fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument());
      expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("closes the unavailable-employee dialog on confirm without saving again", async () => {
      mockEmployees = [{ id: 17, name: "김관리", phone: "010-1111-2222", openToNextWork: false }];
      mockCreateClient.mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
            unavailableEmployees: [{ id: 17, name: "김관리" }],
          },
        },
      });
      renderCreate();
      act(() => {
        useClientWizardStore.getState().setField("primaryEmployeeId", 17);
        useClientWizardStore.getState().setField("endDate", "2026-09-23");
      });

      fireEvent.click(screen.getByRole("button", { name: "등록" }));
      const modal = await screen.findByRole("dialog", { name: "제공인력 배정 확인" });
      expect(mockCreateClient).toHaveBeenCalledTimes(1);

      makeCalendarFail();
      fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

      await waitFor(() => expect(screen.queryByRole("dialog", { name: "제공인력 배정 확인" })).not.toBeInTheDocument());
      expect(mockCreateClient).toHaveBeenCalledTimes(1);
    });
  });

  it("saves a matching create period without carrying confirmation", async () => {
    renderCreate();
    act(() => {
      useClientWizardStore.getState().setField("endDate", "2026-09-23");
      useClientWizardStore.getState().setField("dueDate", "");
      useClientWizardStore.getState().setField("birthDate", "");
    });

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient.mock.calls[0][0]).not.toHaveProperty("allowBusinessDayMismatch");
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      dueDate: null,
      birthDate: null,
    }));
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
  });

  it("allows the basic-details step without due or birth dates", async () => {
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = {
      ...editingClient(),
      phone: "010-1234-5678",
      dueDate: null,
      birthDate: null,
    };
    render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().phone).toBe("010-1234-5678"));
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    await waitFor(() => expect(useClientWizardStore.getState().currentStep).toBe(1));
  });

  it("confirms activation before assigning an unavailable employee and completing registration", async () => {
    mockEmployees = [{
      id: 17,
      name: "김관리",
      phone: "010-1111-2222",
      openToNextWork: false,
    }];
    const confirmationError = {
      response: {
        status: 409,
        data: {
          code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
          unavailableEmployees: [{ id: 17, name: "김관리" }],
        },
      },
    };
    mockCreateClient
      .mockRejectedValueOnce(confirmationError)
      .mockRejectedValueOnce(confirmationError)
      .mockResolvedValueOnce({ id: 1 });
    renderCreate();
    act(() => {
      useClientWizardStore.getState().setField("primaryEmployeeId", 17);
      useClientWizardStore.getState().setField("endDate", "2026-09-23");
    });

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    const modal = await screen.findByRole("dialog", { name: "제공인력 배정 확인" });

    expect(within(modal).getByText(
      "김관리 제공인력은 현재 배정이 불가한 상태입니다. 배정 가능 상태로 전환하고 배정을 진행할까요?",
    )).toBeInTheDocument();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);

    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    expect(mockCreateClient).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    fireEvent.click(within(
      await screen.findByRole("dialog", { name: "제공인력 배정 확인" }),
    ).getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      primaryEmployeeId: 17,
      confirmedUnavailableEmployeeIds: [17],
    })));
    expect(mockPush).toHaveBeenCalledWith("/clients");
  });

  it("opens the modal from the server-current unavailable set when the employee snapshot is stale", async () => {
    mockEmployees = [{
      id: 17,
      name: "예전 이름",
      phone: "010-1111-2222",
      openToNextWork: true,
    }];
    mockCreateClient
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
            unavailableEmployees: [{ id: 17, name: "김관리" }],
          },
        },
      })
      .mockResolvedValueOnce({ id: 1 });
    renderCreate();
    act(() => {
      useClientWizardStore.getState().setField("primaryEmployeeId", 17);
      useClientWizardStore.getState().setField("endDate", "2026-09-23");
    });

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    const modal = await screen.findByRole("dialog", { name: "제공인력 배정 확인" });
    expect(within(modal).getByText(
      "김관리 제공인력은 현재 배정이 불가한 상태입니다. 배정 가능 상태로 전환하고 배정을 진행할까요?",
    )).toBeInTheDocument();

    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(2));
    expect(mockCreateClient).toHaveBeenLastCalledWith(expect.objectContaining({
      confirmedUnavailableEmployeeIds: [17],
    }));
    expect(mockPush).toHaveBeenCalledWith("/clients");
  });

  it("re-prompts with the changed locked employee set before activating anyone", async () => {
    mockEmployees = [
      { id: 17, name: "김주", phone: "010-1111-2222", openToNextWork: false },
      { id: 23, name: "이보조", phone: "010-3333-4444", openToNextWork: true },
    ];
    mockCreateClient
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
            unavailableEmployees: [{ id: 17, name: "김주" }],
          },
        },
      })
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
            unavailableEmployees: [
              { id: 17, name: "김주" },
              { id: 23, name: "이보조" },
            ],
          },
        },
      })
      .mockResolvedValueOnce({ id: 1 });
    renderCreate();
    act(() => {
      useClientWizardStore.getState().setField("primaryEmployeeId", 17);
      useClientWizardStore.getState().setField("secondaryEmployeeId", 23);
      useClientWizardStore.getState().setField("endDate", "2026-09-23");
    });

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    let modal = await screen.findByRole("dialog", { name: "제공인력 배정 확인" });
    expect(within(modal).getByText(/김주 제공인력은/)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

    modal = await screen.findByRole("dialog", { name: "제공인력 배정 확인" });
    expect(within(modal).getByText(/김주, 이보조 제공인력은/)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(3));
    expect(mockCreateClient).toHaveBeenLastCalledWith(expect.objectContaining({
      confirmedUnavailableEmployeeIds: [17, 23],
    }));
  });

  it("chains the duration confirmation into employee activation confirmation", async () => {
    mockEmployees = [{
      id: 17,
      name: "김관리",
      phone: "010-1111-2222",
      openToNextWork: false,
    }];
    mockCreateClient
      .mockRejectedValueOnce({
        response: {
          status: 409,
          data: {
            code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED",
            unavailableEmployees: [{ id: 17, name: "김관리" }],
          },
        },
      })
      .mockResolvedValueOnce({ id: 1 });
    renderCreate();
    act(() => useClientWizardStore.getState().setField("primaryEmployeeId", 17));

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    const durationModal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    fireEvent.click(within(durationModal).getByRole("button", { name: "확인" }));

    const employeeModal = await screen.findByRole("dialog", { name: "제공인력 배정 확인" });
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    fireEvent.click(within(employeeModal).getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      allowBusinessDayMismatch: true,
      confirmedUnavailableEmployeeIds: [17],
    })));
  });

  it("invalidates a pending confirmation when the period changes", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await screen.findByRole("dialog", { name: "서비스 기간 확인" });

    act(() => {
      useClientWizardStore.getState().setField("endDate", "2026-09-09");
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument());
    expect(mockCreateClient).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "서비스 기간 확인" })).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      endDate: "2026-09-09",
      allowBusinessDayMismatch: true,
    })));
  });

  it("keeps a manually cleared or changed end date until the start date changes", async () => {
    renderCreate();

    const endDateInput = screen.getByDisplayValue("2026-09-08");
    fireEvent.change(endDateInput, { target: { value: "" } });
    expect(endDateInput).toHaveValue("");

    fireEvent.change(endDateInput, { target: { value: "2026-09-09" } });
    expect(endDateInput).toHaveValue("2026-09-09");

    fireEvent.change(screen.getByDisplayValue("2026-09-03"), { target: { value: "2026-09-04" } });
    await waitFor(() => expect(endDateInput).toHaveValue(calcEndDateBusinessDays("2026-09-04", 15)));
  });

  it("keeps a manual end-date clear after late contract-document hydration", async () => {
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = { ...editingClient(), eDocId: "late-contract-document" };
    const view = render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe("2026-09-08"));
    act(() => useClientWizardStore.getState().setCurrentStep(2));
    mockEditingContractDocument = {};
    view.rerender(<NewClientPage />);

    const endDateInput = screen.getByDisplayValue("2026-09-08");
    fireEvent.change(endDateInput, { target: { value: "" } });
    expect(endDateInput).toHaveValue("");
  });

  it("keeps a manual end-date clear when the pending contract document resolves afterward", async () => {
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = { ...editingClient(), eDocId: "pending-contract-document" };
    const view = render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe("2026-09-08"));
    act(() => useClientWizardStore.getState().setCurrentStep(2));
    const endDateInput = screen.getByDisplayValue("2026-09-08");
    fireEvent.change(endDateInput, { target: { value: "" } });
    expect(endDateInput).toHaveValue("");

    mockLatePrefill = { endDate: "2026-09-10" };
    mockEditingContractDocument = {};
    view.rerender(<NewClientPage />);

    await waitFor(() => expect(endDateInput).toHaveValue(""));
  });

  it("keeps cached client dates when the client and contract queries are ready on first render", async () => {
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = {
      ...editingClient(),
      eDocId: "cached-contract-document",
      dueDate: "",
      startDate: "2026-09-01",
      endDate: "2026-09-22",
    };
    mockEditingContractDocument = { id: "cached-contract-document" };
    mockLatePrefill = {
      dueDate: "2026-08-11",
      startDate: "2026-09-03",
      endDate: "2026-09-08",
    };

    render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().startDate).toBe("2026-09-01"));
    expect(useClientWizardStore.getState().endDate).toBe("2026-09-22");
    expect(useClientWizardStore.getState().dueDate).toBe("2026-08-11");
  });

  it("requires edit confirmation and prevents duplicate confirmed submissions", async () => {
    let finish!: (value: { id: number }) => void;
    mockUpdateClient.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = editingClient();
    render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe("2026-09-08"));
    act(() => {
      useClientWizardStore.getState().setCurrentStep(2);
    });
    // Editing the period is what makes the saved period need confirming; a save that leaves it alone does not.
    fireEvent.change(document.getElementById("endDate") as HTMLInputElement, { target: { value: "2026-09-09" } });

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    const confirm = within(modal).getByRole("button", { name: "확인" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: 7,
      dto: {
        duration: 15,
        startDate: "2026-09-03",
        endDate: "2026-09-09",
        expectedEndDate: "2026-09-08",
        allowBusinessDayMismatch: true,
      },
    });
    await act(async () => {
      finish({ id: 7 });
    });
  });

  it("hydrates employee IDs from a contract prefill and preserves a later user edit", async () => {
    mockEmployees = [
      { id: 17, name: "김관리", phone: "010-1111-2222" },
      { id: 23, name: "이관리", phone: "010-3333-4444" },
    ];
    act(() => {
      useClientDialogStore.getState().setPrefillClient({
        name: "후보 고객",
        primaryEmployeeId: 17,
        secondaryEmployeeId: 23,
      });
    });

    render(<NewClientPage />);

    await waitFor(() => {
      expect(useClientWizardStore.getState().primaryEmployeeId).toBe(17);
      expect(useClientWizardStore.getState().secondaryEmployeeId).toBe(23);
    });

    act(() => {
      useClientWizardStore.getState().setField("primaryEmployeeId", 23);
    });
    expect(useClientWizardStore.getState().primaryEmployeeId).toBe(23);
    expect(useClientWizardStore.getState().secondaryEmployeeId).toBe(23);
  });
});
