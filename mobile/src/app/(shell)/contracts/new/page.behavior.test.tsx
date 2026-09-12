import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared";
import type { ChangeEvent, ReactNode } from "react";

import type { Client } from "@/lib/client/types";

const mockPush = jest.fn();
const mockStartNavigation = jest.fn();
const mockInvalidateQueries = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockCreateDocRecord = jest.fn();
const mockAdoptDocument = jest.fn();
const mockOpenDocument = jest.fn();
const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockToast = jest.fn();
const mockUseFormStore = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

jest.mock("@/stores/form-store", () => ({
  useFormStore: () => mockUseFormStore(),
}));

jest.mock("@/hooks", () => ({
  useVoucherYears: () => ({ data: [2026] }),
  useVoucherPriceInfos: () => ({ data: [] }),
  useAreaTemplates: () => ({ data: [] }),
  useAllVoucherPrices: () => ({ data: [] }),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: [{
    id: 7,
    name: "테스트 고객",
    phone: "01012345678",
    eDocId: null,
  } as Client], isError: false, error: null, refetch: jest.fn(), isFetching: false }),
  useCreateClient: () => ({ mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [{ id: 11, name: "테스트 제공인력", phone: "01099998888", workArea: [] }] }),
}));

jest.mock("@/hooks/useEformsign", () => ({
  useEformsign: () => ({ isLoaded: true, openDocument: mockOpenDocument }),
}));

jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: mockStartNavigation }),
}));

jest.mock("@/hooks/use-toast", () => ({ toast: mockToast }));

jest.mock("@/hooks/useEformsignDocuments", () => ({
  eformsignQueryKeys: { documents: () => ["eformsign-documents"] },
}));

jest.mock("@/services/api", () => ({
  eformsignApi: {
    dispatchHeadless: mockDispatchHeadless,
    generateDocument: mockGenerateDocument,
    createDocRecord: mockCreateDocRecord,
    adoptDocument: mockAdoptDocument,
  },
}));

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: (props: Record<string, unknown>) => {
    const React = jest.requireActual("react") as typeof import("react");
    const onInputValueChange = props.onInputValueChange as ((value: string) => void) | undefined;
    return React.createElement("input", {
      id: props.inputId,
      value: props.inputValue ?? "",
      onChange: (event: ChangeEvent<HTMLInputElement>) => onInputValueChange?.(event.target.value),
    });
  },
}));

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => null,
}));

jest.mock("@/components/app/eformsign/HeadlessProgressModal", () => ({
  HeadlessProgressModal: () => null,
}));

jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
  MobileTwoButtonModal: (props: Record<string, unknown>) => {
    const React = jest.requireActual("react") as typeof import("react");
    if (!props.open) return null;
    return React.createElement(
      "div",
      { "data-testid": "mobile-two-button-modal" },
      React.createElement("p", null, props.description as ReactNode),
      React.createElement(
        "button",
        { type: "button", onClick: props.onCancel as () => void },
        (props.cancelLabel as ReactNode) ?? "취소",
      ),
      React.createElement(
        "button",
        { type: "button", onClick: props.onConfirm as () => void },
        (props.confirmLabel as ReactNode) ?? "확인",
      ),
    );
  },
}));

jest.mock("@/components/ui/switch", () => ({ Switch: () => null }));

jest.mock("@/components/ui/alert", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    Alert: (props: Record<string, unknown>) => React.createElement("div", props, props.children as ReactNode),
    AlertTitle: (props: Record<string, unknown>) => React.createElement("strong", props, props.children as ReactNode),
    AlertDescription: (props: Record<string, unknown>) => React.createElement("div", props, props.children as ReactNode),
  };
});

jest.mock("@/components/ui/button", () => {
  const React = jest.requireActual("react") as typeof import("react");
  return {
    Button: (props: Record<string, unknown>) => React.createElement("button", props, props.children as ReactNode),
  };
});

jest.mock("lucide-react", () => ({
  ChevronLeft: () => null,
  X: () => null,
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function installEventSourceStub() {
  class EventSourceStub {
    addEventListener = jest.fn();
    close = jest.fn();
  }
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    writable: true,
    value: EventSourceStub,
  });
}

function installFormState(overrides: Record<string, unknown> = {}) {
  const setter = () => jest.fn();
  mockUseFormStore.mockReturnValue({
    clientId: 7,
    isManualEntry: false,
    name: "테스트 고객",
    phone: "010-1234-5678",
    birthday: "900101",
    dueDate: "",
    address: "인천시",
    employeeId: 11,
    isEmployeeManualEntry: false,
    employeeName: "테스트 제공인력",
    employeePhone: "010-9999-8888",
    showEmployee2: false,
    employee2Id: null,
    isEmployee2ManualEntry: false,
    employee2Name: "",
    employee2Phone: "",
    startDate: "2026-09-10",
    endDate: "2026-09-16",
    fullPrice: "100000",
    grant: "50000",
    actualPrice: "50000",
    paymentDate: "2026-09-10",
    voucherType: "A가1형",
    voucherDuration: "5",
    voucherYear: 2026,
    area: "Namdonggu",
    preservePrefilledPrices: false,
    setClientId: setter(),
    setIsManualEntry: setter(),
    setName: setter(),
    setPhone: setter(),
    setBirthday: setter(),
    setDueDate: setter(),
    setAddress: setter(),
    setEmployeeId: setter(),
    setIsEmployeeManualEntry: setter(),
    setEmployeePhone: setter(),
    setEmployeeSelection: setter(),
    setShowEmployee2: setter(),
    setIsEmployee2ManualEntry: setter(),
    setEmployee2Selection: setter(),
    setStartDate: setter(),
    setEndDate: setter(),
    setFullPrice: setter(),
    setGrant: setter(),
    setActualPrice: setter(),
    setPaymentDate: setter(),
    setVoucherType: setter(),
    setVoucherDuration: setter(),
    setVoucherYear: setter(),
    setArea: setter(),
    setPreservePrefilledPrices: setter(),
    ...overrides,
  });
}

async function renderReadyPage() {
  const { default: ContractCreationPage } = await import("./page");
  render(<ContractCreationPage />);
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  return screen.getByRole("button", { name: "계약서 생성" });
}

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  installEventSourceStub();
  installFormState();
  mockCreateClient.mockResolvedValue({ id: 8 });
  mockUpdateClient.mockResolvedValue({ id: 7 });
  mockCreateDocRecord.mockResolvedValue({ id: 21, documentId: "doc-iframe" });
  mockAdoptDocument.mockResolvedValue({ documentId: "doc-adopted" });
  mockGenerateDocument.mockResolvedValue({ mode: { type: "01" } });
});

describe("contract creation mutation lifecycle", () => {
  it("sends at most once on a same-tick double click and locks an unknown result", async () => {
    const pending = deferred<unknown>();
    mockDispatchHeadless.mockReturnValue(pending.promise);
    const submit = await renderReadyPage();

    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));

    await act(async () => {
      pending.resolve({ ok: false, reason: "remote_unconfirmed", fallbackHint: "manual_check", durationMs: 1 });
      await pending.promise;
    });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("계약서 생성 결과를 확인할 수 없어");
    });
    expect(submit).toBeDisabled();
    expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
  });

  it("keeps a confirmed partial outcome locked with its request id", async () => {
    const problem = createProblemDetails({
      code: "MESSAGE_SEND_PARTIAL",
      requestId: "contract-partial-1",
      status: 502,
      outcome: "PARTIALLY_APPLIED",
    });
    mockDispatchHeadless.mockResolvedValue(problem);
    const submit = await renderReadyPage();

    fireEvent.click(submit);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("문자 일부만 발송됐어요");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("contract-partial-1");
    expect(submit).toBeDisabled();
    expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
  });

  it("locks an iframe close without a validated callback", async () => {
    mockDispatchHeadless.mockResolvedValue({
      ok: false,
      reason: "template_navigation_failed",
      failedStep: "info-inserted",
      fallbackHint: "iframe",
      durationMs: 1,
    });
    const submit = await renderReadyPage();
    fireEvent.click(submit);

    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalledTimes(1), { timeout: 1_500 });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("계약서 생성 결과를 확인할 수 없어");
    });
    expect(submit).toBeDisabled();
    expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
  });

  it("navigates only after a validated iframe callback and local record", async () => {
    jest.useFakeTimers();
    mockDispatchHeadless.mockResolvedValue({
      ok: false,
      reason: "template_navigation_failed",
      failedStep: "info-inserted",
      fallbackHint: "iframe",
      durationMs: 1,
    });
    const submit = await renderReadyPage();
    fireEvent.click(submit);

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    act(() => jest.advanceTimersByTime(500));
    expect(mockOpenDocument).toHaveBeenCalledTimes(1);
    const options = mockOpenDocument.mock.calls[0]?.[2] as {
      onSuccess: (response: unknown) => Promise<void>;
    };
    await act(async () => {
      await options.onSuccess({ code: "-1", document_id: "doc-iframe" });
    });

    expect(mockCreateDocRecord).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(3_000));
    expect(mockPush).toHaveBeenCalledWith("/contracts");
  });
});

describe("duplicate-phone conflict handling", () => {
  const CONFLICT_TEXT = "이미 같은 전화번호의 고객이 있습니다. 기존 고객으로 계약을 진행할까요?";

  /** Axios-like 409 rejection the BFF produces for a duplicate-phone conflict. */
  function conflictError(data: Record<string, unknown>) {
    return Object.assign(new Error("Request failed with status code 409"), {
      isAxiosError: true,
      response: { status: 409, data },
    });
  }

  beforeEach(() => {
    // clearAllMocks leaves mock*Once queues intact; a stale queued rejection
    // would leak into the next test's first create call.
    mockCreateClient.mockReset();
    mockCreateClient.mockResolvedValue({ id: 8 });
    // Manual entry without a selected client: submitting runs the
    // auto-registration create path. The name/phone must not match the
    // mocked client list, or the page would reuse a stored client instead.
    installFormState({
      clientId: null,
      isManualEntry: true,
      name: "새로운 고객",
      phone: "010-6621-1878",
    });
  });

  it("offers the reuse retry when the 409 carries the public duplicate-phone code", async () => {
    mockCreateClient
      .mockRejectedValueOnce(conflictError({
        code: "CLIENT_PHONE_ALREADY_REGISTERED",
        message: "같은 전화번호의 고객이 이미 등록되어 있어요.",
      }))
      .mockResolvedValueOnce({ id: 73 });
    mockDispatchHeadless.mockResolvedValue({ ok: true });

    const submit = await renderReadyPage();
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByText(CONFLICT_TEXT)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(2));
    expect(mockCreateClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ reuseExistingClient: true }),
    );
  });

  it("still offers the reuse retry for the legacy clientId conflict payload", async () => {
    mockCreateClient
      .mockRejectedValueOnce(conflictError({
        message: "이미 같은 전화번호의 고객이 있습니다.",
        clientId: 73,
      }))
      .mockResolvedValueOnce({ id: 73 });
    mockDispatchHeadless.mockResolvedValue({ ok: true });

    const submit = await renderReadyPage();
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByText(CONFLICT_TEXT)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(2));
    expect(mockCreateClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ reuseExistingClient: true }),
    );
  });

  it("fails the submission without a reuse offer for any other 409", async () => {
    mockCreateClient.mockRejectedValueOnce(conflictError({
      message: "자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요.",
    }));

    const submit = await renderReadyPage();
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(CONFLICT_TEXT)).not.toBeInTheDocument();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });
});
