import { createProblemDetails } from "@babyjamjam/shared";
import { normalizeApiError } from "@babyjamjam/shared/errors/problem-details";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import type { Client } from "@/lib/client/types";
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
const mockOutOfPocketPrices = [{ id: 1, duration: 10, fullPrice: "1" }];
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
  duration: 10,
  fullPrice: "1",
  grant: "0",
  actualPrice: "1",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking" as const,
  areaId: "",
  currentStep: 2,
  pricesManuallyEdited: false,
  voucherYear: null,
};

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
    bookingConfirmedAt: null,
    eDocId: null,
    areaId: null,
    hasSigned: false,
    documentStatus: null,
  };
}

const startedTitle = "서비스 시작 후 변경";
const recordsTitle = "제공기록지 회차 처리";
const lock = { serviceStarted: true, recordedSessionCount: 3 };
const lockedError = (startDateLock: unknown = lock, status = 409) => ({
  response: {
    status,
    data: {
      ...createProblemDetails({ code: "SERVICE_RECORD_START_DATE_LOCKED", requestId: "req-start-date-lock" }),
      status,
      ...(startDateLock !== null && { startDateLock }),
    },
  },
});
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = (name: string) => screen.getByRole("button", { name });

async function openEdit() {
  mockSearchParams = new URLSearchParams("clientId=7");
  mockEditingClient = editingClient();
  const view = render(<NewClientPage />);
  await waitFor(() => expect(useClientWizardStore.getState().name).toBe(initialForm.name));
  act(() => useClientWizardStore.getState().setCurrentStep(2));
  return view;
}

async function saveChangedDate() {
  act(() => useClientWizardStore.getState().setField("primaryEmployeeId", 42));
  fireEvent.change(field("startDate"), { target: { value: "2026-11-03" } });
  fireEvent.change(field("endDate"), { target: { value: "2026-11-16" } });
  fireEvent.click(button("저장"));
  await waitFor(() => expect(mockUpdateClient).toHaveBeenCalled());
}

const partialMessage = "시작일 변경은 저장했지만 담당 인력 변경은 저장하지 못했어요. 창을 닫고 다시 열어 담당 인력을 바꿔 주세요.";
const retryFailure = {
  response: { status: 409, data: createProblemDetails({
    code: "SERVICE_RECORD_WRITE_TARGET_CHANGED", requestId: "req-retry-failure", status: 409,
  }) },
};

async function chooseMode(mode: "MOVE" | "RESTART" | "CONFIRM_STARTED") {
  if (mode === "CONFIRM_STARTED") return;
  const confirmation = await screen.findByRole("dialog", { name: recordsTitle });
  fireEvent.click(within(confirmation).getByRole("button", {
    name: mode === "MOVE" ? "모두 옮기기" : "처음부터 시작",
  }));
}

function expectNoConfirmation() {
  expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
}

describe("mobile edit page split employee save after start-date confirmation", () => {
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


  it.each(["MOVE", "RESTART", "CONFIRM_STARTED"] as const)(
    "%s saves employees separately and only navigates after their save resolves", async (mode) => {
      let finishEmployee!: (value: Client) => void;
      mockUpdateClient
        .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: mode === "CONFIRM_STARTED" ? 0 : 3 }))
        .mockResolvedValueOnce(editingClient())
        .mockImplementationOnce(() => new Promise((resolve) => { finishEmployee = resolve; }));
      await openEdit();
      await saveChangedDate();
      await chooseMode(mode);
      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(3));
      const { primaryEmployeeId, ...periodDto } = mockUpdateClient.mock.calls[0][0].dto;
      expect(primaryEmployeeId).toBe(42);
      expect(mockUpdateClient.mock.calls[1][0]).toEqual({
        id: 7, dto: { ...periodDto, startDateChangeMode: mode },
      });
      expect(mockUpdateClient.mock.calls[1][0].dto).not.toHaveProperty("secondaryEmployeeId");
      expect(mockUpdateClient.mock.calls[2][0]).toEqual({ id: 7, dto: { primaryEmployeeId: 42 } });
      expect(mockPush).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "저장 중...", hidden: true }));
      expect(mockUpdateClient).toHaveBeenCalledTimes(3);
      await act(async () => finishEmployee({ ...editingClient(), name: "담당 인력 저장 결과" }));
      expect(mockPush).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith("/clients?id=7");
      expectNoConfirmation();
    },
  );

  it("keeps the page and request ID when the employee save fails, without the period error handler", async () => {
    mockUpdateClient
      .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
      .mockResolvedValueOnce(editingClient())
      .mockRejectedValueOnce(retryFailure);
    await openEdit();
    await saveChangedDate();
    await chooseMode("MOVE");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(partialMessage);
    expect(alert).toHaveTextContent("요청 ID: req-retry-failure");
    expect(mockPush).not.toHaveBeenCalled();
    expectNoConfirmation();
    fireEvent.click(button("저장"));
    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(4));
  });

  it("uses the existing error when the start-date save fails, without saving employees", async () => {
    mockUpdateClient
      .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
      .mockRejectedValueOnce(retryFailure);
    await openEdit();
    await saveChangedDate();
    await chooseMode("MOVE");
    expect(await screen.findByRole("alert")).toHaveTextContent("그동안 서비스 종료일이 바뀌어 저장하지 않았어요.");
    expect(screen.queryByText(partialMessage)).not.toBeInTheDocument();
    expect(mockUpdateClient).toHaveBeenCalledTimes(2);
    expect(mockPush).not.toHaveBeenCalled();
    expectNoConfirmation();
  });

  it.each(["UNKNOWN", "PARTIALLY_APPLIED"] as const)(
    "preserves the %s outcome and blocks further saves after an employee failure", async (outcome) => {
      const error = { response: { status: 500, data: createProblemDetails({
        code: "INTERNAL_ERROR", requestId: "req-uncertain-employee", outcome,
      }) } };
      mockUpdateClient
        .mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
        .mockResolvedValueOnce(editingClient())
        .mockRejectedValueOnce(error);
      await openEdit();
      await saveChangedDate();
      await chooseMode("MOVE");
      const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
      expect(await screen.findByRole("alert")).toHaveTextContent(outcome === "UNKNOWN" ? normalized.message : partialMessage);
      expect(screen.getByRole("alert")).toHaveTextContent("요청 ID: req-uncertain-employee");
      if (outcome === "UNKNOWN") expect(screen.queryByText(partialMessage)).not.toBeInTheDocument();
      fireEvent.click(button("저장"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(mockUpdateClient).toHaveBeenCalledTimes(3);
      expect(mockPush).not.toHaveBeenCalled();
      expectNoConfirmation();
    },
  );

  it.each(["start date", "employee"])("ignores a %s save that resolves after unmount", async (stage) => {
    let finish!: (value: Client) => void;
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }));
    if (stage === "employee") mockUpdateClient.mockResolvedValueOnce(editingClient());
    mockUpdateClient.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = await openEdit();
    await saveChangedDate();
    await chooseMode("MOVE");
    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(stage === "employee" ? 3 : 2));
    view.unmount();
    await act(async () => finish(editingClient()));
    expect(mockUpdateClient).toHaveBeenCalledTimes(stage === "employee" ? 3 : 2);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
