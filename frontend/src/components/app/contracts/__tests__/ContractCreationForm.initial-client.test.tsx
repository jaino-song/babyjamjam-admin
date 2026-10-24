/**
 * Coverage for the wizard's `initialClient` mode (clients-page "산모 계약서
 * 생성" menu → MaternityContractDialog): the one-time prefill effect at
 * ContractCreationForm.tsx:669-682, the disabled client selector at :1236,
 * and that the pre-existing default (no `initialClient`) client-select path
 * is unaffected.
 *
 * Rendering-based coverage also checks queue acceptance, retry identity and
 * the explicit manual fallback rather than source-string assertions.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useFormStore } from "@/stores/form-store";
import type { Client } from "@/lib/client/types";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
const mockDispatchHeadless = jest.fn();
const mockEnqueueDocumentCreation = jest.fn().mockResolvedValue({ jobId: "job-1", status: "queued", existing: false });
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();
const mockCreateClientMutateAsync = jest.fn().mockResolvedValue({ id: 999 });
const mockUpdateClientMutateAsync = jest.fn().mockResolvedValue({});
const mockDeleteClientMutateAsync = jest.fn().mockResolvedValue({});

let mockClients: Client[] = [];
const mockAreaTemplates = [
  {
    id: "area-template-namdonggu",
    areaId: "Namdonggu",
    templateId: "template-namdonggu",
    templateName: "남동구 산모 계약서",
  },
  {
    id: "area-template-seogu",
    areaId: "Seogu",
    templateId: "template-seogu",
    templateName: "서구 산모 계약서",
  },
  {
    id: "area-template-incheon",
    areaId: "인천",
    templateId: "template-incheon",
    templateName: "인천 산모 계약서",
  },
];

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
  useEformsign: () => ({
    isLoaded: true,
    isLoading: false,
    error: null,
    openDocument: mockOpenDocument,
  }),
}));

jest.mock("@/services/api", () => ({
  eformsignApi: {
    enqueueDocumentCreation: (...args: unknown[]) => mockEnqueueDocumentCreation(...args),
    authenticate: (...args: unknown[]) => mockAuthenticate(...args),
    dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
    generateDocument: (...args: unknown[]) => mockGenerateDocument(...args),
    createDocRecord: jest.fn().mockResolvedValue({}),
    adoptDocument: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: mockCreateClientMutateAsync, isPending: false }),
  useUpdateClient: () => ({ mutateAsync: mockUpdateClientMutateAsync, isPending: false }),
  useDeleteClient: () => ({ mutateAsync: mockDeleteClientMutateAsync, isPending: false }),
  // Only used when step 1 (client selector) is actually rendered.
  useAllClients: () => ({ data: mockClients, isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAreaTemplates: () => ({ data: mockAreaTemplates, isLoading: false }),
}));

// The SSE channel is orthogonal here; a no-op source keeps the headless
// dispatch path from touching EventSource, which jsdom does not implement.
jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CONTRACT_INFO_STEP_INDEX = 3;

const BASE_CLIENT: Client = {
  id: 0,
  name: "",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: null,
  phone: null,
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: null,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: null,
  endDate: null,
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: null,
  bookingConfirmedAt: null,
  eDocId: null,
  areaId: null,
  hasSigned: false,
  documentStatus: null,
};

function makeClient(overrides: Partial<Client>): Client {
  return { ...BASE_CLIENT, ...overrides };
}

// Full fixture for the prefill assertions: every field the plan asks for.
const clientA = makeClient({
  id: 101,
  name: "김민지",
  phone: "010-1111-2222",
  birthday: "950101",
  address: "인천시 남동구 123",
  dueDate: "2026-09-01",
  birthDate: "2026-08-20",
  type: "일반",
  duration: 15,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  startDate: "2026-08-05",
  endDate: "2026-08-26",
  areaId: "Namdonggu",
});

// A second, mostly-empty client for the idempotent-remount case — no
// birthDate/voucher/pricing fields, so any residue from clientA would show.
const clientB = makeClient({
  id: 202,
  name: "이서연",
  phone: "010-3333-4444",
  birthday: "970202",
  address: "인천시 서구 456",
  dueDate: "2026-10-10",
  areaId: "Seogu",
});

// Used only for the default-mode (no initialClient) regression case.
const clientC = makeClient({
  id: 303,
  name: "박지영",
  phone: "010-5555-6666",
  startDate: "2026-08-10",
});

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function seedValidContract(overrides: Partial<ReturnType<typeof useFormStore.getState>> = {}) {
  useFormStore.setState({
    clientId: 42,
    name: "송진호",
    phone: "010-6621-1878",
    birthday: "960414",
    dueDate: "",
    birthDate: "",
    address: "인천시 강다",
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
    ...overrides,
  });
}

describe("ContractCreationForm — initialClient mode", () => {
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
    mockEnqueueDocumentCreation.mockReset().mockResolvedValue({ jobId: "job-1", status: "queued", existing: false });
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
    mockClients = [];
    useFormStore.getState().resetAll();
  });

  function renderQueueForm(supersedeDocumentId?: string) {
    seedValidContract();
    const onSuccess = jest.fn();
    const onClose = jest.fn();
    renderWithProviders(<ContractCreationForm activeStep={3} onActiveStepChange={jest.fn()} onSuccess={onSuccess} onClose={onClose} supersedeDocumentId={supersedeDocumentId} />);
    return { onSuccess, onClose };
  }

  async function submitQueue() {
    const previousCalls = mockEnqueueDocumentCreation.mock.calls.length;
    fireEvent.click(screen.getByTestId("contract-creation-submit"));
    await waitFor(() => expect(mockEnqueueDocumentCreation).toHaveBeenCalledTimes(previousCalls + 1));
    await waitFor(() => expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled());
  }

  function expectNoDirectSend() {
    expect(mockGenerateDocument).not.toHaveBeenCalled();
    expect(mockOpenDocument).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  }

  it.each([
    [undefined, "전자문서 생성을 시작했어요"],
    ["old-contract", "계약서 재발행을 시작했어요"],
  ])("accepts queued creation/re-issue %s before closing", async (supersedeDocumentId, description) => {
    let accept!: (value: { jobId: string; status: string; existing: boolean }) => void;
    mockEnqueueDocumentCreation.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve; }));
    const { onSuccess, onClose } = renderQueueForm(supersedeDocumentId);
    fireEvent.click(screen.getByTestId("contract-creation-submit"));
    await waitFor(() => expect(mockEnqueueDocumentCreation).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(mockEnqueueDocumentCreation.mock.calls[0][0]).toEqual(expect.objectContaining({
      clientId: 42,
      ...(supersedeDocumentId ? { supersedeDocumentId } : {}),
    }));
    await act(async () => accept({ jobId: "job-1", status: "queued", existing: false }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({ description });
    expectNoDirectSend();
  });

  it.each([503, 400, 409, 500, 502, 504, undefined])("retains inputs after rejection %s and only exposes safe manual fallback", async (status) => {
    mockEnqueueDocumentCreation.mockRejectedValueOnce({ isAxiosError: true, ...(status ? { response: { status, data: {} } } : {}) });
    const { onSuccess, onClose } = renderQueueForm();
    await submitQueue();
    expect(screen.getByRole("alert")).toHaveTextContent(/.+/);
    expect(screen.getByLabelText("계약 시작일")).toHaveValue("2026-08-05");
    expect(useFormStore.getState()).toEqual(expect.objectContaining({ name: "송진호", phone: "010-6621-1878", address: "인천시 강다", actualPrice: "200000" }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expectNoDirectSend();
    if (status === 503 || (status !== undefined && status >= 400 && status < 500)) {
      fireEvent.click(screen.getByTestId("contract-creation-manual"));
      await waitFor(() => expect(mockGenerateDocument).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledTimes(1));
      expect(mockEnqueueDocumentCreation).toHaveBeenCalledTimes(1);
    } else {
      expect(screen.queryByTestId("contract-creation-manual")).not.toBeInTheDocument();
    }
  });

  it("reuses a rejected request key only while submission content is unchanged", async () => {
    mockEnqueueDocumentCreation.mockRejectedValue(new Error("Network Error"));
    renderQueueForm();
    await submitQueue();
    await submitQueue();
    const first = mockEnqueueDocumentCreation.mock.calls[0][0].requestKey;
    expect(mockEnqueueDocumentCreation.mock.calls[1][0].requestKey).toBe(first);
    fireEvent.change(screen.getByLabelText("계약 시작일"), { target: { value: "2026-08-06" } });
    await submitQueue();
    expect(mockEnqueueDocumentCreation.mock.calls[2][0].requestKey).not.toBe(first);
    expectNoDirectSend();
  });

  it("never retries a fresh-key collision or treats dropped request data as accepted", async () => {
    mockEnqueueDocumentCreation.mockResolvedValue({ jobId: "other-job", status: "queued", existing: true });
    const { onSuccess } = renderQueueForm();
    await submitQueue();
    const message = "이 고객의 전자문서 작업이 이미 진행 중이에요. 처리중 목록에서 확인해 주세요.";
    expect(screen.getByText(message)).toBeVisible();
    await submitQueue();
    expect(screen.getByText(message)).toBeVisible();
    expect(mockEnqueueDocumentCreation.mock.calls[1][0].requestKey).not.toBe(mockEnqueueDocumentCreation.mock.calls[0][0].requestKey);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByTestId("contract-creation-manual")).not.toBeInTheDocument();
    expectNoDirectSend();
  });

  it("clears the request key after confirmed acceptance", async () => {
    const { onSuccess } = renderQueueForm();
    await submitQueue();
    await submitQueue();
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(mockEnqueueDocumentCreation.mock.calls[1][0].requestKey).not.toBe(mockEnqueueDocumentCreation.mock.calls[0][0].requestKey);
  });

  it.each(["failed", "requires_attention", "queued", "completed"])("handles same-key existing retry with status %s", async (status) => {
    mockEnqueueDocumentCreation.mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce({ jobId: "job-1", status, existing: true });
    const { onSuccess } = renderQueueForm();
    await submitQueue();
    await submitQueue();
    expect(mockEnqueueDocumentCreation.mock.calls[1][0].requestKey).toBe(mockEnqueueDocumentCreation.mock.calls[0][0].requestKey);
    if (status === "failed" || status === "requires_attention") {
      expect(screen.getByText("전자문서 작업을 완료하지 못했어요. 처리중 목록에서 확인해 주세요.")).toBeVisible();
      expect(onSuccess).not.toHaveBeenCalled();
    } else {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    }
    expectNoDirectSend();
  });

  it("prefills step-1 fields and area in the store, leaving paymentDate empty despite startDate", () => {
    renderWithProviders(<ContractCreationForm initialClient={clientA} />);

    const state = useFormStore.getState();
    expect(state.name).toBe(clientA.name);
    expect(state.phone).toBe(clientA.phone);
    expect(state.birthday).toBe("1995-01-01");
    expect(state.address).toBe(clientA.address);
    expect(state.dueDate).toBe(clientA.dueDate);
    expect(state.birthDate).toBe(clientA.birthDate);
    expect(state.area).toBe(clientA.areaId);

    // Rest of the fixture also lands in the store via the normal
    // handleClientSelect path the effect delegates to.
    expect(state.voucherType).toBe(clientA.type);
    expect(state.voucherDuration).toBe(String(clientA.duration));
    expect(state.fullPrice).toBe(clientA.fullPrice);
    expect(state.grant).toBe(clientA.grant);
    expect(state.actualPrice).toBe(clientA.actualPrice);
    expect(state.startDate).toBe(clientA.startDate);
    // endDate is then recomputed by the separate business-day auto-calc
    // effect (unrelated to initialClient), so we only assert it's populated
    // rather than pin its exact value to the fixture's raw endDate.
    expect(state.endDate).not.toBe("");

    // The one behavior this feature must guarantee even though startDate is set.
    expect(state.paymentDate).toBe("");

    // Spot-check the rendered DOM reflects the same values.
    expect(screen.getByRole("combobox", { name: "산모님 성함" })).toHaveTextContent(clientA.name);
    expect(screen.getByLabelText("출산일")).toHaveValue("2026-08-20");
  });

  it("disables the client selector trigger when initialClient is provided", () => {
    renderWithProviders(<ContractCreationForm initialClient={clientA} />);

    const trigger = screen.getByRole("combobox", { name: "산모님 성함" });
    expect(trigger).toBeDisabled();
  });

  it("still auto-sets paymentDate to the selected client's startDate without initialClient (contracts-page regression guard)", () => {
    mockClients = [clientC];
    renderWithProviders(<ContractCreationForm />);

    const trigger = screen.getByRole("combobox", { name: "산모님 성함" });
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);
    fireEvent.change(screen.getByPlaceholderText("새로 입력 또는 기존 고객 선택"), {
      target: { value: clientC.name },
    });
    // The client's name now also matches in the trigger button itself (the
    // inline manual-value mirrors the typed query), so scope to the option row.
    fireEvent.click(screen.getByText(clientC.name, { selector: "span.font-medium" }));

    expect(useFormStore.getState().paymentDate).toBe(clientC.startDate);
  });

  it("re-applies cleanly for a different initialClient after unmount+remount, with no residue from the previous client", () => {
    const { unmount } = renderWithProviders(<ContractCreationForm initialClient={clientA} />);
    expect(useFormStore.getState().birthDate).toBe(clientA.birthDate);
    expect(useFormStore.getState().area).toBe(clientA.areaId);
    unmount();

    renderWithProviders(<ContractCreationForm initialClient={clientB} />);

    const state = useFormStore.getState();
    expect(state.name).toBe(clientB.name);
    expect(state.area).toBe(clientB.areaId);
    // clientB has no birthDate — a leftover from clientA would fail this.
    expect(state.birthDate).toBe("");
    expect(state.voucherType).toBe("");
    expect(state.fullPrice).toBe("");
    expect(state.paymentDate).toBe("");
  });

  it("carries a typed YYYYMMDD 출산일 through to the update-client mutation as an ISO birthDate", async () => {
    seedValidContract({ birthDate: "" });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onActiveStepChange = jest.fn();
    function Wrapper({ activeStep }: { activeStep: number }) {
      return (
        <QueryClientProvider client={queryClient}>
          <ContractCreationForm activeStep={activeStep} onActiveStepChange={onActiveStepChange} />
        </QueryClientProvider>
      );
    }

    const { rerender } = render(<Wrapper activeStep={0} />);

    // 출산일 (delivery date) is typed as digits and shown as YYYY-MM-DD.
    fireEvent.change(screen.getByLabelText("출산일"), { target: { value: "20260805" } });
    expect(screen.getByLabelText("출산일")).toHaveValue("2026-08-05");

    // Same component instance (same key/position) — local birthDateInput
    // state survives the step jump, exactly like the wizard's own stepper.
    rerender(<Wrapper activeStep={CONTRACT_INFO_STEP_INDEX} />);

    mockDispatchHeadless.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockUpdateClientMutateAsync).toHaveBeenCalled());
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        dto: expect.objectContaining({ birthDate: "2026-08-05" }),
      }),
    );
  });

  it("sends null when an existing client's 출산일 is explicitly cleared", async () => {
    seedValidContract({ birthDate: "2026-08-05" });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ContractCreationForm activeStep={0} onActiveStepChange={jest.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("출산일"), { target: { value: "" } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ContractCreationForm activeStep={CONTRACT_INFO_STEP_INDEX} onActiveStepChange={jest.fn()} />
      </QueryClientProvider>,
    );
    mockDispatchHeadless.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockUpdateClientMutateAsync).toHaveBeenCalled());
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ dto: expect.objectContaining({ birthDate: null }) }),
    );
  });

  it("signals onSubmissionStateChange(true) then (false) around a contract-creation run", async () => {
    seedValidContract();
    mockDispatchHeadless.mockResolvedValue({ ok: true });
    const onSubmissionStateChange = jest.fn();

    renderWithProviders(
      <ContractCreationForm
        activeStep={CONTRACT_INFO_STEP_INDEX}
        onActiveStepChange={jest.fn()}
        onSubmissionStateChange={onSubmissionStateChange}
      />,
    );

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    expect(onSubmissionStateChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onSubmissionStateChange).toHaveBeenLastCalledWith(false));
    expect(onSubmissionStateChange.mock.calls[0]).toEqual([true]);
  });

  it("signals onSubmissionStateChange(false) even when enqueue rejects", async () => {
    seedValidContract();
    mockEnqueueDocumentCreation.mockRejectedValue(new Error("Network Error"));
    const onSubmissionStateChange = jest.fn();

    renderWithProviders(
      <ContractCreationForm
        activeStep={CONTRACT_INFO_STEP_INDEX}
        onActiveStepChange={jest.fn()}
        onSubmissionStateChange={onSubmissionStateChange}
      />,
    );

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    expect(onSubmissionStateChange).toHaveBeenCalledWith(true);
    await waitFor(() => expect(onSubmissionStateChange).toHaveBeenLastCalledWith(false));
  });
});
