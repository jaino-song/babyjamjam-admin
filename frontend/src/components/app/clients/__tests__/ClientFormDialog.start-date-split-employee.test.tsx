import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useState } from "react";
import { createProblemDetails } from "@babyjamjam/shared";
import type { UpdateClientDto } from "@/features/clients/types";

import { api } from "@/lib/api/client";

import type { Client } from "@/lib/client/types";

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
  useUpdateClient: function useUpdateClient() {
    const [isPending, setIsPending] = useState(false);
    return {
      isPending,
      mutateAsync: async (args: { id: number; dto: UpdateClientDto }) => {
        setIsPending(true);
        try {
          return await mockUpdateClient(args);
        } finally {
          setIsPending(false);
        }
      },
    };
  },
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
  EmployeeAutocomplete: ({ label, value, onChange }: {
    label: string; value: number | null; onChange: (id: number | null) => void;
  }) => (
    <select aria-label={label} value={value ?? ""}
      onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}>
      <option value="">선택 없음</option>
      <option value="99">QA-새 담당 인력</option>
    </select>
  ),
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

const client: Client = {
  id: 2, name: "시작일 변경 테스트", birthday: "900101", dueDate: "2026-08-01",
  address: "인천시", phone: "01012345678", voucherClient: false, duration: 15,
  startDate: "2026-08-26", endDate: "2026-09-14", createdAt: "2026-08-01",
  breastPump: false, careCenter: false, primaryEmployee: null, secondaryEmployee: null,
  serviceStatus: "active", bookingConfirmedAt: "2026-08-01", hasSigned: false,
  documentStatus: null, eDocId: null, birthDate: null, type: null,
  fullPrice: null, grant: null, actualPrice: null,
};
const startedTitle = "서비스 시작 후 변경";
const recordsTitle = "제공기록지 회차 처리";

function lockError(lock?: { serviceStarted: boolean; recordedSessionCount: number }) {
  return {
    response: {
      status: 409,
      data: {
        ...createProblemDetails({ code: "SERVICE_RECORD_START_DATE_LOCKED", requestId: "req-start-date" }),
        ...(lock && { startDateLock: lock }),
      },
    },
  };
}

const partialSaveMessage = "시작일 변경은 저장했지만 담당 인력 변경은 저장하지 못했어요. 창을 닫고 다시 열어 담당 인력을 바꿔 주세요.";
const employeeClient = { ...client, name: "담당 인력까지 저장한 고객" };

async function submitChangedStartDateAndEmployee() {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  const props = { open: true, client, onClose, onSuccess };
  const view = render(<ClientFormDialog {...props} />);
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByRole("combobox", { name: "주 담당 인력" }), { target: { value: "99" } });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-08-27" } });
  });
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-09-14" } });
  const saveButton = screen.getByRole("button", { name: "저장" });
  fireEvent.click(saveButton);
  const durationModal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
  fireEvent.click(within(durationModal).getByRole("button", { name: "확인" }));
  await waitFor(() => expect(mockUpdateClient).toHaveBeenCalled());
  expect(mockUpdateClient.mock.calls[0][0].dto).toEqual({
    primaryEmployeeId: 99,
    startDate: "2026-08-27", endDate: "2026-09-14", duration: 15,
    expectedEndDate: "2026-09-14", allowBusinessDayMismatch: true,
  });
  return { ...view, ...props, saveButton };
}

async function confirmRecords(label = "모두 옮기기") {
  const started = await screen.findByRole("dialog", { name: startedTitle });
  fireEvent.click(within(started).getByRole("button", { name: "진행" }));
  const records = await screen.findByRole("dialog", { name: recordsTitle });
  // Count only the confirmation requests, after the initial locked save.
  mockUpdateClient.mockClear();
  fireEvent.click(within(records).getByRole("button", { name: label }));
  return records;
}

function expectSplitRequests(mode: string) {
  expect(mockUpdateClient).toHaveBeenCalledTimes(2);
  expect(mockUpdateClient.mock.calls[0][0]).toEqual({
    id: client.id,
    dto: {
      startDate: "2026-08-27", endDate: "2026-09-14", duration: 15,
      expectedEndDate: "2026-09-14", allowBusinessDayMismatch: true,
      startDateChangeMode: mode,
    },
  });
  expect(mockUpdateClient.mock.calls[1][0]).toEqual({
    id: client.id, dto: { primaryEmployeeId: 99 },
  });
}

function rejectedUpdate(code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" | "INTERNAL_ERROR" = "SERVICE_RECORD_WRITE_TARGET_CHANGED") {
  return { response: { status: code === "INTERNAL_ERROR" ? 500 : 409,
    data: createProblemDetails({ code, requestId: "req-employee" }),
  } };
}

function deferredClient() {
  let resolve!: (value: Client) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Client>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("client start-date confirmation with an employee change", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset().mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset();
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }))
      .mockResolvedValueOnce(client)
      .mockResolvedValue(employeeClient);
  });

  it.each([
    ["모두 옮기기", "MOVE"],
    ["처음부터 시작", "RESTART"],
  ])("splits %s into two requests and succeeds once with the employee response", async (label, mode) => {
    const { onSuccess, onClose } = await submitChangedStartDateAndEmployee();
    await confirmRecords(label);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(employeeClient));
    expectSplitRequests(mode);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the partial-save message and request id without closing when the employee request fails", async () => {
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }))
      .mockResolvedValueOnce(client)
      .mockRejectedValueOnce(rejectedUpdate());
    const { onSuccess, onClose } = await submitChangedStartDateAndEmployee();
    await confirmRecords();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(partialSaveMessage);
    expect(alert).toHaveTextContent("req-employee");
    expectSplitRequests("MOVE");
    expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
  });

  it("keeps existing error handling and skips the employee request when the start-date request fails", async () => {
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }))
      .mockRejectedValueOnce(rejectedUpdate());
    const { onSuccess, onClose } = await submitChangedStartDateAndEmployee();
    await confirmRecords();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("종료일");
    expect(alert).toHaveTextContent("req-employee");
    expect(alert).not.toHaveTextContent(partialSaveMessage);
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(mockUpdateClient.mock.calls[0][0].dto).not.toHaveProperty("primaryEmployeeId");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("treats an unstructured legacy 4xx employee response as a non-blocking partial save", async () => {
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }))
      .mockResolvedValueOnce(client)
      .mockRejectedValueOnce({ response: { status: 400, data: { message: "legacy" } } });
    const { onSuccess, onClose } = await submitChangedStartDateAndEmployee();
    await confirmRecords();
    expect(await screen.findByRole("alert")).toHaveTextContent(partialSaveMessage);
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    expectSplitRequests("MOVE");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ["transport", new Error("transport failed")],
    ["server", { response: { status: 500, data: createProblemDetails({
      code: "INTERNAL_ERROR", requestId: "req-unknown", outcome: "UNKNOWN",
    }) } }],
  ])("preserves an UNKNOWN %s employee outcome and blocks subsequent saves", async (_kind, failure) => {
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }))
      .mockResolvedValueOnce(client)
      .mockRejectedValueOnce(failure);
    const { onSuccess, onClose } = await submitChangedStartDateAndEmployee();
    await confirmRecords();
    expect(await screen.findByText("다시 실행하기 전에 작업 상태를 확인해 주세요.")).toBeVisible();
    expect(screen.queryByText(partialSaveMessage)).not.toBeInTheDocument();
    const save = screen.getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천 새 주소" } });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expectSplitRequests("MOVE");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("splits the automatic CONFIRM_STARTED retry", async () => {
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: false, recordedSessionCount: 0 }))
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(employeeClient);
    const { onSuccess, onClose } = await submitChangedStartDateAndEmployee();
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(employeeClient));
    expect(mockUpdateClient).toHaveBeenCalledTimes(3);
    expect(mockUpdateClient.mock.calls[1][0].dto).toEqual({
      startDate: "2026-08-27", endDate: "2026-09-14", duration: 15,
      expectedEndDate: "2026-09-14", allowBusinessDayMismatch: true,
      startDateChangeMode: "CONFIRM_STARTED",
    });
    expect(mockUpdateClient.mock.calls[2][0]).toEqual({ id: client.id, dto: { primaryEmployeeId: 99 } });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
  });

  it("splits an explicit CONFIRM_STARTED retry", async () => {
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 0 }))
      .mockResolvedValueOnce(client)
      .mockResolvedValueOnce(employeeClient);
    const { onSuccess } = await submitChangedStartDateAndEmployee();
    const started = await screen.findByRole("dialog", { name: startedTitle });
    mockUpdateClient.mockClear();
    fireEvent.click(within(started).getByRole("button", { name: "진행" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(employeeClient));
    expectSplitRequests("CONFIRM_STARTED");
  });

  it("keeps both choices disabled across both requests and prevents duplicate submissions", async () => {
    const start = deferredClient();
    const employee = deferredClient();
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }))
      .mockReturnValueOnce(start.promise)
      .mockReturnValueOnce(employee.promise);
    const { onSuccess, saveButton } = await submitChangedStartDateAndEmployee();
    const records = await confirmRecords();
    const move = within(records).getByRole("button", { name: "모두 옮기기" });
    const restart = within(records).getByRole("button", { name: "처음부터 시작" });
    expect(move).toBeDisabled();
    expect(restart).toBeDisabled();
    await act(async () => { start.resolve(client); });
    expect(move).toBeDisabled();
    expect(restart).toBeDisabled();
    // All submit/retry UI paths are disabled while pending; submissionInFlightRef is defense-in-depth here.
    fireEvent.click(move);
    fireEvent.click(saveButton);
    expectSplitRequests("MOVE");
    expect(onSuccess).not.toHaveBeenCalled();
    await act(async () => { employee.resolve(employeeClient); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each(["start", "employee"])("ignores a late %s response after the form session closes", async (stage) => {
    const pending = deferredClient();
    mockUpdateClient.mockReset()
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }));
    if (stage === "employee") mockUpdateClient.mockResolvedValueOnce(client);
    mockUpdateClient.mockReturnValueOnce(pending.promise);
    const { rerender, onSuccess, onClose } = await submitChangedStartDateAndEmployee();
    await confirmRecords();
    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(stage === "start" ? 1 : 2));
    rerender(<ClientFormDialog open={false} client={null}
      onSuccess={onSuccess} onClose={onClose} />);
    await act(async () => { pending.resolve(employeeClient); });
    expect(mockUpdateClient).toHaveBeenCalledTimes(stage === "start" ? 1 : 2);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
