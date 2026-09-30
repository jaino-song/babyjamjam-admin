/**
 * When the contract form is submitted for an existing client whose stored
 * values differ from the form, staff choose between applying the edits to the
 * contract only and also updating the client. Nothing is sent before the
 * choice, dismissing the dialog cancels the submit, and clients that are
 * auto-registered in the same submit never see the dialog.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockCreateClientMutateAsync = jest.fn();
const mockUpdateClientMutateAsync = jest.fn();
const mockDeleteClientMutateAsync = jest.fn();
const mockEnqueueMutateAsync = jest.fn();
const mockDispatchHeadless = jest.fn();

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
  useEformsign: () => ({
    isLoaded: true,
    isLoading: false,
    error: null,
    openDocument: jest.fn(),
  }),
}));

jest.mock("@/services/api", () => ({
  eformsignApi: {
    dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
    generateDocument: jest.fn(),
    createDocRecord: jest.fn().mockResolvedValue({}),
    adoptDocument: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => flag === "eformsignDocumentJobs",
}));

jest.mock("@/hooks/useEformsignDocumentJobs", () => ({
  useEnqueueEformsignDocumentCreation: () => ({
    mutateAsync: (...args: unknown[]) => mockEnqueueMutateAsync(...args),
    isPending: false,
  }),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: (...args: unknown[]) => mockCreateClientMutateAsync(...args), isPending: false }),
  useUpdateClient: () => ({ mutateAsync: (...args: unknown[]) => mockUpdateClientMutateAsync(...args), isPending: false }),
  useDeleteClient: () => ({ mutateAsync: (...args: unknown[]) => mockDeleteClientMutateAsync(...args), isPending: false }),
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({
    data: [{ id: 7, name: "김정인", phone: "010-5787-1878" }],
    isLoading: false,
  }),
}));

jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({
    data: [{ duration: "15", fullPrice: 1000000, grant: 800000, actualPrice: 200000 }],
    isLoading: false,
  }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
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
const DIALOG_TITLE = "고객 정보와 다른 내용이 있어요";
const CONTRACT_ONLY_LABEL = "계약서에만 반영";
const UPDATE_CLIENT_LABEL = "고객 정보도 수정";
const PERIOD_LOCKED_NOTE = "서비스 기록이 확정된 고객이라 계약 기간은 계약서에만 반영돼요.";

const BASE_CLIENT: Client = {
  id: 501,
  name: "김민지",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: "인천시 남동구",
  phone: "010-1111-2222",
  primaryEmployee: { id: 7, name: "김정인", phone: "010-5787-1878" },
  secondaryEmployee: null,
  type: "일반",
  duration: 15,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  // 2026-09-07 + 15 business days is 2026-09-29 by the calendar the form uses,
  // so an untouched form matches the stored client.
  startDate: "2026-09-07",
  endDate: "2026-09-29",
  careCenter: false,
  voucherClient: true,
  breastPump: false,
  serviceStatus: null,
  eDocId: null,
  areaId: "인천",
  hasSigned: false,
  documentStatus: null,
};

function renderForm(props: { initialClient?: Client } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm
        initialClient={props.initialClient}
        activeStep={CONTRACT_INFO_STEP_INDEX}
        onActiveStepChange={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

function renderExistingClient(client: Client) {
  const view = renderForm({ initialClient: client });
  // The wizard requires a payment date; the initial-client path clears it.
  act(() => {
    useFormStore.getState().setPaymentDate("2026-09-07");
  });
  return view;
}

function submit() {
  fireEvent.click(screen.getByTestId("contract-creation-submit"));
}

describe("ContractCreationForm — confirm before writing form edits back to the client", () => {
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
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockCreateClientMutateAsync.mockReset().mockResolvedValue({ id: 999 });
    mockUpdateClientMutateAsync.mockReset().mockResolvedValue({});
    mockDeleteClientMutateAsync.mockReset().mockResolvedValue({});
    mockEnqueueMutateAsync.mockReset().mockResolvedValue({});
    useFormStore.getState().resetAll();
  });

  it("lists the changed phone and, for 계약서에만 반영, enqueues the contract without updating the client", async () => {
    renderExistingClient(BASE_CLIENT);
    act(() => {
      useFormStore.getState().setPhone("010-9999-8888");
    });

    submit();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(DIALOG_TITLE)).toBeInTheDocument();
    expect(
      within(dialog).getByText("계약서에 입력한 내용이 저장된 고객 정보와 달라요. 고객 정보도 함께 수정할까요?"),
    ).toBeInTheDocument();
    const rows = within(dialog).getAllByText(/→/);
    expect(rows).toHaveLength(1);
    expect(within(dialog).getByText("산모님 연락처")).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent("010-1111-2222 → 010-9999-8888");
    // Nothing is written before the choice.
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockEnqueueMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: CONTRACT_ONLY_LABEL }));

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockEnqueueMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 501,
        contractData: expect.objectContaining({ customerContact: "010-9999-8888" }),
      }),
    );
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
  });

  it("updates the client with the new phone and then enqueues for 고객 정보도 수정", async () => {
    renderExistingClient(BASE_CLIENT);
    act(() => {
      useFormStore.getState().setPhone("010-9999-8888");
    });

    submit();
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: UPDATE_CLIENT_LABEL }));

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith({
      id: 501,
      dto: expect.objectContaining({ phone: "010-9999-8888", startDate: "2026-09-07", endDate: "2026-09-29" }),
    });
    expect(mockUpdateClientMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnqueueMutateAsync.mock.invocationCallOrder[0],
    );
    expect(mockEnqueueMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        contractData: expect.objectContaining({ customerContact: "010-9999-8888" }),
      }),
    );
  });

  it("does not ask, and skips the no-op client update, when nothing differs", async () => {
    renderExistingClient(BASE_CLIENT);

    submit();

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(DIALOG_TITLE)).not.toBeInTheDocument();
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
  });

  it("persists only the staff assignment for 계약서에만 반영 when the stored client has no primary employee", async () => {
    renderExistingClient({ ...BASE_CLIENT, primaryEmployee: null });
    act(() => {
      useFormStore.getState().setEmployeeSelection(7, "김정인", "010-5787-1878");
    });

    submit();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("제공인력 1")).toBeInTheDocument();
    expect(within(dialog).getByText(/\(없음\) → 김정인/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: CONTRACT_ONLY_LABEL }));

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith({
      id: 501,
      dto: { primaryEmployeeId: 7, secondaryEmployeeId: null },
    });
  });

  it("leaves the period out of the client update for a finalized client and says so in the dialog", async () => {
    renderExistingClient({ ...BASE_CLIENT, endDate: "2026-09-30", serviceRecordPeriodLocked: true });
    fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: "2026-10-05" } });
    act(() => {
      useFormStore.getState().setPhone("010-9999-8888");
    });

    submit();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("계약 종료일")).toBeInTheDocument();
    expect(within(dialog).getByText(/2026-09-30 → 2026-10-05/)).toBeInTheDocument();
    expect(within(dialog).getByText(PERIOD_LOCKED_NOTE)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: UPDATE_CLIENT_LABEL }));

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);
    const { dto } = mockUpdateClientMutateAsync.mock.calls[0][0] as { dto: Record<string, unknown> };
    expect(dto).toEqual(expect.objectContaining({ phone: "010-9999-8888" }));
    expect(dto).not.toHaveProperty("startDate");
    expect(dto).not.toHaveProperty("endDate");
    expect(dto).not.toHaveProperty("duration");
    // The contract itself still carries the edited period.
    expect(mockEnqueueMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        contractData: expect.objectContaining({ endDate: "2026-10-05" }),
      }),
    );
  });

  it("omits the period note when a finalized client's period is unchanged", async () => {
    renderExistingClient({ ...BASE_CLIENT, serviceRecordPeriodLocked: true });
    act(() => {
      useFormStore.getState().setPhone("010-9999-8888");
    });

    submit();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(PERIOD_LOCKED_NOTE)).not.toBeInTheDocument();
  });

  it.each([
    ["the close button", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
    ["Escape", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })],
  ])("sends nothing and keeps the form when the dialog is dismissed with %s", async (_label, dismiss) => {
    renderExistingClient(BASE_CLIENT);
    act(() => {
      useFormStore.getState().setPhone("010-9999-8888");
    });

    submit();
    await screen.findByRole("dialog");
    dismiss();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockEnqueueMutateAsync).not.toHaveBeenCalled();
    expect(useFormStore.getState().phone).toBe("010-9999-8888");
    // The double-submit guard was released, so the form can be submitted again.
    await waitFor(() => expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled());
    submit();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("does not ask again when the same values are resubmitted after 계약서에만 반영", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockEnqueueMutateAsync.mockRejectedValueOnce(new Error("enqueue failed"));
    renderExistingClient(BASE_CLIENT);
    act(() => {
      useFormStore.getState().setPhone("010-9999-8888");
    });

    submit();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: CONTRACT_ONLY_LABEL }));
    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled());

    submit();

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
  });

  it("never asks for a client that is auto-registered in the same submit", async () => {
    useFormStore.setState({
      clientId: null,
      name: "송진호",
      phone: "010-6621-1878",
      birthday: "",
      dueDate: "",
      birthDate: "",
      address: "인천시",
      employeeId: 7,
      employeeName: "김정인",
      employeePhone: "01057871878",
      showEmployee2: false,
      employee2Id: null,
      startDate: "2026-08-05",
      endDate: "2026-08-25",
      paymentDate: "2026-08-05",
      fullPrice: "1000000",
      grant: "800000",
      actualPrice: "200000",
      voucherType: "일반",
      voucherDuration: "15",
      area: "인천",
    });
    renderForm();

    submit();

    await waitFor(() => expect(mockEnqueueMutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(DIALOG_TITLE)).not.toBeInTheDocument();
    expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockEnqueueMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ clientId: 999 }));
  });
});
