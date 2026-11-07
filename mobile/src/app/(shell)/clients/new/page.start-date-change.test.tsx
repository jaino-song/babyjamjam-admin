import userEvent from "@testing-library/user-event";
import { createProblemDetails } from "@babyjamjam/shared";
import { CLIENT_END_DATE_CHANGED_MESSAGE } from "@/components/app/clients/client-update-payload";

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
const base = "mobile_clients-new_screen_root";
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
const modal = (title: string) => screen.getByRole("dialog", { name: title });

async function openEdit() {
  mockSearchParams = new URLSearchParams("clientId=7");
  mockEditingClient = editingClient();
  const view = render(<NewClientPage />);
  await waitFor(() => expect(useClientWizardStore.getState().name).toBe(initialForm.name));
  act(() => useClientWizardStore.getState().setCurrentStep(2));
  return view;
}

async function saveChangedDate() {
  fireEvent.change(field("startDate"), { target: { value: "2026-11-03" } });
  fireEvent.change(field("endDate"), { target: { value: "2026-11-16" } });
  fireEvent.click(button("저장"));
  await waitFor(() => expect(mockUpdateClient).toHaveBeenCalled());
}

function expectNoConfirmation() {
  expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
}

function expectKeptForm() {
  expect(mockUpdateClient).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(field("startDate")).toHaveValue("2026-11-03");
  expect(field("endDate")).toHaveValue("2026-11-16");
  expect(useClientWizardStore.getState()).toMatchObject({ ...initialForm, pricesManuallyEdited: true, startDate: "2026-11-03", endDate: "2026-11-16" });
}

function switchClient(view: ReturnType<typeof render>) {
  mockSearchParams = new URLSearchParams("clientId=8");
  mockEditingClient = { ...editingClient(), id: 8, name: "다음 고객" };
  view.rerender(<NewClientPage />);
  act(() => useClientWizardStore.getState().setCurrentStep(2));
}

describe("mobile edit page start-date confirmation", () => {
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

  it.each([["모두 옮기기", "MOVE"], ["처음부터 시작", "RESTART"]])(
    "confirms started and records, then sends %s using the remembered request", async (label, mode) => {
      mockUpdateClient.mockRejectedValueOnce(lockedError());
      await openEdit();
      await saveChangedDate();
      const started = await screen.findByRole("dialog", { name: startedTitle });
      expect(started).toHaveAttribute("data-component", `${base}_start-date-started-confirmation`);
      expect(started).toHaveTextContent("서비스가 이미 시작되었어요. 그래도 변경할까요?");
      expect(within(started).getAllByRole("button").map((item) => item.textContent)).toEqual(["취소", "진행"]);
      const saveButton = screen.getByRole("button", { name: "저장", hidden: true });
      fireEvent.click(saveButton);
      expect(mockUpdateClient).toHaveBeenCalledTimes(1);
      fireEvent.click(button("진행"));
      const records = await screen.findByRole("dialog", { name: recordsTitle });
      expect(records).toHaveAttribute("data-component", `${base}_start-date-records-confirmation`);
      expect(records).toHaveTextContent("이미 제출된 제공기록지 기록이 있어요. 새로운 시작일을 기준으로 1회차부터 작성된 회차까지 모두 옮길까요?");
      expect(within(records).getAllByRole("button").map((item) => item.textContent)).toEqual(["처음부터 시작", "모두 옮기기"]);
      expect(mockUpdateClient).toHaveBeenCalledTimes(1);
      const firstRequest = mockUpdateClient.mock.calls[0][0];
      act(() => useClientWizardStore.getState().setField("address", "확인 중 바꾼 주소"));
      fireEvent.click(button(label));
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/clients?id=7"));
      expect(mockUpdateClient).toHaveBeenCalledTimes(2);
      expect(mockUpdateClient.mock.calls[1][0]).toEqual({ id: 7, dto: { ...firstRequest.dto, startDateChangeMode: mode } });
      expect(firstRequest.dto).not.toHaveProperty("startDateChangeMode");
      expectNoConfirmation();
    },
  );

  it("confirms started with no records without opening records", async () => {
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: true, recordedSessionCount: 0 }));
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: startedTitle });
    fireEvent.click(button("진행"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/clients?id=7"));
    expect(mockUpdateClient.mock.calls[1][0]).toEqual({ id: 7, dto: { ...mockUpdateClient.mock.calls[0][0].dto, startDateChangeMode: "CONFIRM_STARTED" } });
    expectNoConfirmation();
  });

  it("opens records directly for an unstarted service with records", async () => {
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }));
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: recordsTitle });
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    expectKeptForm();
  });

  it("silently retries an unstarted service with no records and never renders a modal", async () => {
    let finishRetry!: () => void;
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 0 }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishRetry = resolve; }));
    const addedModals: Element[] = [];
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[role="dialog"]')) addedModals.push(node);
        addedModals.push(...node.querySelectorAll('[role="dialog"]'));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      await openEdit();
      await saveChangedDate();
      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(2));
      expectNoConfirmation();
      expect(mockUpdateClient.mock.calls[1][0]).toEqual({ id: 7, dto: { ...mockUpdateClient.mock.calls[0][0].dto, startDateChangeMode: "CONFIRM_STARTED" } });
      fireEvent.click(button("저장 중..."));
      expect(mockUpdateClient).toHaveBeenCalledTimes(2);
      await act(async () => finishRetry());
      expect(mockPush).toHaveBeenCalledWith("/clients?id=7");
      expect(addedModals).toEqual([]);
    } finally {
      observer.disconnect();
    }
  });

  it.each(["cancel", "escape", "backdrop"])("dismisses started via %s and preserves all edits", async (action) => {
    mockUpdateClient.mockRejectedValueOnce(lockedError());
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: startedTitle });
    const user = userEvent.setup();
    if (action === "cancel") await user.click(button("취소"));
    else if (action === "escape") await user.keyboard("{Escape}");
    else await user.click(document.querySelector(`[data-component="${base}_start-date-started-confirmation_overlay"]`)!);
    await waitFor(() => expectNoConfirmation());
    expectKeptForm();
  });

  it.each(["escape", "backdrop"])("dismisses records via %s without sending RESTART", async (action) => {
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }));
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: recordsTitle });
    const user = userEvent.setup();
    if (action === "escape") await user.keyboard("{Escape}");
    else await user.click(document.querySelector(`[data-component="${base}_start-date-records-confirmation_overlay"]`)!);
    await waitFor(() => expectNoConfirmation());
    expectKeptForm();
  });

  it("uses normal errors when the retry is rejected with another lock", async () => {
    mockUpdateClient.mockRejectedValue(lockedError());
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: startedTitle });
    fireEvent.click(button("진행"));
    fireEvent.click(button("모두 옮기기"));
    expect(await screen.findByRole("alert")).toHaveTextContent("요청 ID: req-start-date-lock");
    expectNoConfirmation();
    expect(mockUpdateClient).toHaveBeenCalledTimes(2);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("sends one retry on double click and prevents dismissal while pending", async () => {
    let finishRetry!: () => void;
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishRetry = resolve; }));
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: recordsTitle });
    const move = button("모두 옮기기");
    fireEvent.click(move);
    fireEvent.click(move);
    expect(mockUpdateClient).toHaveBeenCalledTimes(2);
    expect(move).toBeDisabled();
    expect(button("처음부터 시작")).toBeDisabled();
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    await user.click(document.querySelector(`[data-component="${base}_start-date-records-confirmation_overlay"]`)!);
    expect(modal(recordsTitle)).toHaveAttribute("aria-busy", "true");
    await act(async () => finishRetry());
    expect(mockPush).toHaveBeenCalledWith("/clients?id=7");
  });

  it.each([
    ["missing lock", null, 409],
    ["malformed lock", { serviceStarted: true, recordedSessionCount: -1 }, 409],
    ["non-409 status", lock, 400],
  ])("uses today's inline error for %s", async (_label, unusableLock, status) => {
    mockUpdateClient.mockRejectedValueOnce(lockedError(unusableLock, status as number));
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("alert");
    expectNoConfirmation();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("preserves the end-date guard error on retry", async () => {
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
      .mockRejectedValueOnce({ response: { status: 409, data: createProblemDetails({
        code: "SERVICE_RECORD_WRITE_TARGET_CHANGED", requestId: "req-end-date-moved", status: 409,
      }) } });
    await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: recordsTitle });
    expect(mockUpdateClient.mock.calls[0][0].dto).toHaveProperty("expectedEndDate");
    fireEvent.click(button("모두 옮기기"));
    expect(await screen.findByText(CLIENT_END_DATE_CHANGED_MESSAGE)).toBeInTheDocument();
    expectNoConfirmation();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("clears pending confirmation on a client switch", async () => {
    mockUpdateClient.mockRejectedValueOnce(lockedError());
    const view = await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: startedTitle });
    switchClient(view);
    expectNoConfirmation();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
  });

  it.each(["resolve", "reject"])("ignores a stale retry %s and releases the guard so client B can save", async (outcome) => {
    let finishRetry!: () => void;
    mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
      .mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
        finishRetry = () => outcome === "resolve" ? resolve() : reject(lockedError());
      }));
    const view = await openEdit();
    await saveChangedDate();
    await screen.findByRole("dialog", { name: recordsTitle });
    fireEvent.click(button("모두 옮기기"));
    switchClient(view);
    await act(async () => finishRetry());
    expectNoConfirmation();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.change(field("startDate"), { target: { value: "2026-11-04" } });
    fireEvent.change(field("endDate"), { target: { value: "2026-11-17" } });
    fireEvent.click(button("저장"));
    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(3));
    expect(mockUpdateClient.mock.calls[2][0].id).toBe(8);
    expect(mockPush).toHaveBeenCalledWith("/clients?id=8");
  });

  it.each([lock, { serviceStarted: false, recordedSessionCount: 0 }])(
    "ignores a stale initial lock without opening confirmation or silently retrying: %j", async (staleLock) => {
      let rejectSave!: (error: unknown) => void;
      mockUpdateClient.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
      const view = await openEdit();
      await saveChangedDate();
      switchClient(view);
      await act(async () => rejectSave(lockedError(staleLock)));
      expectNoConfirmation();
      expect(mockUpdateClient).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it.each(["initial lock", "retry success", "retry failure"])("ignores %s after unmount", async (stage) => {
    let finish!: () => void;
    const deferred = () => new Promise<void>((resolve, reject) => {
      finish = () => stage === "retry success" ? resolve() : reject(lockedError());
    });
    if (stage === "initial lock") mockUpdateClient.mockImplementationOnce(deferred);
    else mockUpdateClient.mockRejectedValueOnce(lockedError({ serviceStarted: false, recordedSessionCount: 3 }))
      .mockImplementationOnce(deferred);
    const view = await openEdit();
    await saveChangedDate();
    if (stage !== "initial lock") {
      await screen.findByRole("dialog", { name: recordsTitle });
      fireEvent.click(button("모두 옮기기"));
    }
    view.unmount();
    await act(async () => finish());
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockUpdateClient).toHaveBeenCalledTimes(stage === "initial lock" ? 1 : 2);
  });
});
