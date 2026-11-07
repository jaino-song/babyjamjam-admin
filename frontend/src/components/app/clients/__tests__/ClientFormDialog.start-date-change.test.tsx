import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { useState } from "react";
import { createProblemDetails } from "@babyjamjam/shared";
import type { UpdateClientDto } from "@/features/clients/types";

import { api } from "@/lib/api/client";

import type { Client } from "@/lib/client/types";

import { ClientFormDialog, ClientFormPanel } from "../ClientFormDialog";

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

async function submitChangedStartDate(surface: "panel" | "dialog" = "panel") {
  const onClose = jest.fn();
  const onSuccess = jest.fn();
  const onDirtyChange = jest.fn();
  const props = { open: true, client, onClose, onSuccess, onDirtyChange };
  const view = render(surface === "panel"
    ? <ClientFormPanel {...props} activeStep={3} />
    : <ClientFormDialog {...props} />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-08-27" } });
  });
  // Keep a deliberately mismatched end date to exercise both confirmation flows together.
  fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-09-14" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  const durationModal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
  fireEvent.click(within(durationModal).getByRole("button", { name: "확인" }));
  await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
  expect(mockUpdateClient.mock.calls[0][0].dto).toEqual({
    startDate: "2026-08-27", endDate: "2026-09-14", duration: 15,
    expectedEndDate: "2026-09-14", allowBusinessDayMismatch: true,
  });
  return { ...view, ...props };
}

function expectNoInlineError() {
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}

function expectRetry(mode: string) {
  expect(mockUpdateClient).toHaveBeenCalledTimes(2);
  const first = mockUpdateClient.mock.calls[0][0];
  expect(first.dto).not.toHaveProperty("startDateChangeMode");
  expect(mockUpdateClient.mock.calls[1][0]).toEqual({
    id: client.id, dto: { ...first.dto, startDateChangeMode: mode },
  });
}

describe("client start-date change confirmation", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset().mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset();
    mockUpdateClient.mockReset().mockResolvedValue(client);
  });

  it("confirms an already started service in the desktop dialog and preserves the exact DTO", async () => {
    mockUpdateClient.mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 0 }));
    const { onSuccess, onClose } = await submitChangedStartDate("dialog");
    const modal = await screen.findByRole("dialog", { name: startedTitle });
    expect(modal).toHaveAttribute("data-component", "desktop_clients_form-dialog_start-date-started-confirmation");
    expect(within(modal).getByText("서비스가 이미 시작되었어요. 그래도 변경할까요?", { selector: "p:not(.sr-only)" })).toBeVisible();
    expectNoInlineError();
    fireEvent.click(within(modal).getByRole("button", { name: "진행" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(client));
    expectRetry("CONFIRM_STARTED");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["처음부터 시작", "RESTART"],
    ["모두 옮기기", "MOVE"],
  ])("asks about records after proceeding and %s sends %s", async (label, mode) => {
    mockUpdateClient.mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 3 }));
    const { onSuccess, onDirtyChange } = await submitChangedStartDate();
    const started = await screen.findByRole("dialog", { name: startedTitle });
    fireEvent.click(within(started).getByRole("button", { name: "진행" }));
    const records = await screen.findByRole("dialog", { name: recordsTitle });
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expectNoInlineError();
    fireEvent.click(within(records).getByRole("button", { name: label }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(client));
    expectRetry(mode);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it.each(["취소", "Close", "Escape", "overlay"])("%s cancels the started confirmation without losing form values", async (action) => {
    mockUpdateClient.mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 0 }));
    const { onClose, onSuccess } = await submitChangedStartDate();
    const modal = await screen.findByRole("dialog", { name: startedTitle });
    if (action === "Escape") fireEvent.keyDown(modal, { key: "Escape" });
    else if (action === "overlay") {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      const overlay = document.querySelector('[data-slot="dialog-overlay"]');
      expect(overlay).toBeInTheDocument();
      fireEvent.pointerDown(overlay as HTMLElement);
    }
    else fireEvent.click(within(modal).getByRole("button", { name: action }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument());
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByLabelText("시작일")).toHaveValue("2026-08-27");
    expectNoInlineError();
  });

  it.each(["Close", "Escape", "overlay"])("%s cancels the records confirmation with no retry or error", async (action) => {
    mockUpdateClient.mockRejectedValueOnce(lockError({ serviceStarted: false, recordedSessionCount: 2 }));
    const { onClose } = await submitChangedStartDate();
    const modal = await screen.findByRole("dialog", { name: recordsTitle });
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    if (action === "Escape") fireEvent.keyDown(modal, { key: "Escape" });
    else if (action === "overlay") {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      const overlay = document.querySelector('[data-slot="dialog-overlay"]');
      expect(overlay).toBeInTheDocument();
      fireEvent.pointerDown(overlay as HTMLElement);
    }
    else fireEvent.click(within(modal).getByRole("button", { name: action }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument());
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("시작일")).toHaveValue("2026-08-27");
    expectNoInlineError();
  });

  it("goes directly to records before service starts and disables both choices during retry", async () => {
    let finish!: (value: Client) => void;
    mockUpdateClient
      .mockRejectedValueOnce(lockError({ serviceStarted: false, recordedSessionCount: 2 }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { onSuccess } = await submitChangedStartDate();
    const modal = await screen.findByRole("dialog", { name: recordsTitle });
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    const move = within(modal).getByRole("button", { name: "모두 옮기기" });
    fireEvent.click(move);
    fireEvent.click(move);
    expect(move).toBeDisabled();
    expect(within(modal).getByRole("button", { name: "처음부터 시작" })).toBeDisabled();
    expectRetry("MOVE");
    await act(async () => { finish(client); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("keeps the inline error for an older backend without a usable extension", async () => {
    mockUpdateClient.mockRejectedValueOnce(lockError());
    await submitChangedStartDate();
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
  });

  it.each(["SERVICE_RECORD_FINALIZED", "SERVICE_RECORD_WRITE_TARGET_CHANGED"] as const)("shows the normal guarded error when retry fails with %s", async (code) => {
    mockUpdateClient
      .mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 0 }))
      .mockRejectedValueOnce({ response: { status: 409, data: createProblemDetails({ code, requestId: "req-retry" }) } });
    const { onSuccess, onClose } = await submitChangedStartDate();
    const modal = await screen.findByRole("dialog", { name: startedTitle });
    fireEvent.click(within(modal).getByRole("button", { name: "진행" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toBeVisible();
    if (code === "SERVICE_RECORD_WRITE_TARGET_CHANGED") {
      expect(alert).toHaveTextContent("종료일");
    }
    expectRetry("CONFIRM_STARTED");
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the remembered confirmation when the panel closes and reopens", async () => {
    mockUpdateClient.mockRejectedValueOnce(lockError({ serviceStarted: true, recordedSessionCount: 0 }));
    const { rerender, onClose, onSuccess } = await submitChangedStartDate();
    await screen.findByRole("dialog", { name: startedTitle });
    rerender(<ClientFormPanel open={false} client={client} onClose={onClose} onSuccess={onSuccess} activeStep={3} />);
    await act(async () => { await Promise.resolve(); });
    rerender(<ClientFormPanel open client={client} onClose={onClose} onSuccess={onSuccess} activeStep={3} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog", { name: startedTitle })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: recordsTitle })).not.toBeInTheDocument();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expectNoInlineError();
  });
});
