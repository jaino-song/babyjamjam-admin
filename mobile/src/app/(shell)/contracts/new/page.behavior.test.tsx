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
const mockSupersedeDocument = jest.fn();
const mockOpenDocument = jest.fn();
const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockToast = jest.fn();
const mockUseFormStore = jest.fn();
// The stored record of the client already selected in the form store (id 7). It matches the
// default form state below, so a submit without edits has nothing to ask about; the page builds
// its diff baseline from this record, not from the store's form values.
const mockClients = [{
  id: 7,
  name: "테스트 고객",
  phone: "01012345678",
  birthday: "1958-03-03",
  address: "인천시",
  areaId: "Namdonggu",
  primaryEmployee: { id: 11, name: "테스트 제공인력" },
  secondaryEmployee: null,
  type: "A가1형",
  duration: 5,
  fullPrice: "100000",
  grant: "50000",
  actualPrice: "50000",
  startDate: "2026-09-10",
  endDate: "2026-09-16",
  eDocId: null,
} as Client];

jest.mock("@/hooks/useBusinessDayCalendar");

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
  useAllClients: () => ({ data: mockClients, isError: false, error: null, refetch: jest.fn(), isFetching: false }),
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
    supersedeDocument: mockSupersedeDocument,
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

// 단일 비행 인증 스트림: 실제 fetch 없이 스텁 EventSource를 돌려준다.
jest.mock("@/lib/api/authenticated-fetch", () => {
  const actual = jest.requireActual<typeof import("@/lib/api/authenticated-fetch")>(
    "@/lib/api/authenticated-fetch",
  );
  return {
    ...actual,
    openAuthenticatedEventSource: jest.fn((url: string | URL) =>
      Promise.resolve(new globalThis.EventSource(url))),
  };
});

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
  const state = {
    clientId: 7,
    isManualEntry: false,
    name: "테스트 고객",
    phone: "010-1234-5678",
    birthday: "1958-03-03",
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
    supersede: null,
    clearSupersede: jest.fn(),
    ...overrides,
  };
  mockUseFormStore.mockReturnValue(state);
  return state;
}

async function renderReadyPage() {
  const { default: ContractCreationPage } = await import("./page");
  render(<ContractCreationPage />);
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  return screen.getByRole("button", { name: "계약서 생성" });
}

function getDateInput(label: string): HTMLInputElement {
  return screen.getByLabelText(new RegExp(label)) as HTMLInputElement;
}

function expectNoContractSideEffects(): void {
  expect(mockCreateClient).not.toHaveBeenCalled();
  expect(mockUpdateClient).not.toHaveBeenCalled();
  expect(mockDispatchHeadless).not.toHaveBeenCalled();
  expect(mockGenerateDocument).not.toHaveBeenCalled();
  expect(mockCreateDocRecord).not.toHaveBeenCalled();
  expect(mockAdoptDocument).not.toHaveBeenCalled();
  expect(mockOpenDocument).not.toHaveBeenCalled();
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
  mockSupersedeDocument.mockResolvedValue(undefined);
});

describe("contract creation mutation lifecycle", () => {
  it.each(["1905-01-01", "2005-01-01", "1958-03-03"])("preserves birthday %s in the live route payload", async (birthday) => {
    installFormState({ birthday, clientId: null, isManualEntry: true, name: "새로운 고객", phone: "010-6621-1878" });
    mockDispatchHeadless.mockResolvedValue({ ok: true });
    const submit = await renderReadyPage();
    fireEvent.click(submit);
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ birthday })));
  });

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

  it.each([
    "template_workflow_config_invalid",
    "template_workflow_unsupported",
    "template_workflow_config_unavailable",
  ])("keeps %s unlocked for a safe retry without reopening the iframe or rewriting the client", async (reason) => {
    mockDispatchHeadless
      .mockResolvedValueOnce({ ok: false, reason, failedStep: "client-started", durationMs: 1 })
      .mockResolvedValueOnce({ ok: true, documentId: "doc-retried", durationMs: 1 });

    const submit = await renderReadyPage();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("이번 요청에서 계약서를 발송하지 않았어요.");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("입력한 고객 정보와 날짜는 그대로 남아 있어요.");
    expect(submit).not.toBeDisabled();
    expect(mockOpenDocument).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockUpdateClient).not.toHaveBeenCalled();

    fireEvent.click(submit);
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(2));
    expect(mockDispatchHeadless.mock.calls[1]?.[1]).toBe(7);
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockUpdateClient).not.toHaveBeenCalled();
    expect(mockOpenDocument).not.toHaveBeenCalled();
  });

  it("updates the retained client before retry when date and assignment values change", async () => {
    const formState = installFormState();
    mockDispatchHeadless
      .mockResolvedValueOnce({
        ok: false,
        reason: "template_workflow_config_unavailable",
        failedStep: "client-started",
        durationMs: 1,
      })
      .mockResolvedValueOnce({ ok: true, documentId: "doc-retried", durationMs: 1 });

    const submit = await renderReadyPage();
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이번 요청에서 계약서를 발송하지 않았어요."));

    formState.employeeId = 12;
    formState.employeeName = "박수정";
    formState.employeePhone = "01011112222";
    formState.startDate = "2026-09-11";
    formState.endDate = "2026-09-17";
    fireEvent.change(getDateInput("시작일"), { target: { value: "20260911" } });

    fireEvent.click(submit);
    // The retry now differs from the stored client, so the page asks before writing it back.
    fireEvent.click(await screen.findByRole("button", { name: "고객 정보도 수정" }));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(2));

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(mockUpdateClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      id: 7,
      dto: expect.objectContaining({
        primaryEmployeeId: 12,
        startDate: "2026-09-11",
        endDate: "2026-09-17",
      }),
    }));
    expect(mockDispatchHeadless.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      caretaker1Name: "박수정",
      caretaker1Contact: "01011112222",
      startDate: "2026-09-11",
      endDate: "2026-09-17",
    }));
    expect(mockDispatchHeadless.mock.calls[1]?.[1]).toBe(7);
  });

  it("retains an auto-registered client id across a known pre-send retry", async () => {
    installFormState({
      clientId: null,
      isManualEntry: true,
      name: "새로운 고객",
      phone: "010-6621-1878",
    });
    mockCreateClient.mockResolvedValue({ id: 73 });
    mockDispatchHeadless
      .mockResolvedValueOnce({ ok: false, reason: "template_workflow_config_unavailable", durationMs: 1 })
      .mockResolvedValueOnce({ ok: true, documentId: "doc-retried", durationMs: 1 });

    const submit = await renderReadyPage();
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이번 요청에서 계약서를 발송하지 않았어요."));

    fireEvent.click(submit);
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(2));
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockDispatchHeadless.mock.calls[0]?.[1]).toBe(73);
    expect(mockDispatchHeadless.mock.calls[1]?.[1]).toBe(73);
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

  it("cancels the re-issued client's previous contract only after the new one was sent", async () => {
    jest.useFakeTimers();
    const state = installFormState({ supersede: { clientId: 7, documentId: "old-doc" } });
    mockDispatchHeadless.mockResolvedValue({
      ok: false,
      reason: "template_navigation_failed",
      failedStep: "info-inserted",
      fallbackHint: "iframe",
      durationMs: 1,
    });
    const submit = await renderReadyPage();
    // The target leaves the store on entry so it cannot leak into a later visit.
    expect(state.clearSupersede).toHaveBeenCalled();
    fireEvent.click(submit);

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    act(() => jest.advanceTimersByTime(500));
    expect(mockSupersedeDocument).not.toHaveBeenCalled();
    const options = mockOpenDocument.mock.calls[0]?.[2] as {
      onSuccess: (response: unknown) => Promise<void>;
    };
    await act(async () => {
      await options.onSuccess({ code: "-1", document_id: "doc-iframe" });
    });

    expect(mockSupersedeDocument).toHaveBeenCalledWith("old-doc", 7);
  });
});

describe("contract date validation", () => {
  const DATE_RANGE_ERROR = "종료일은 시작일 이후여야 해요";
  const DATE_FORMAT_ERROR = "YYYY-MM-DD로 입력해 주세요";

  it("shows a concrete range error, blocks creation on press, focuses the field, and runs no side effects", async () => {
    installFormState({ startDate: "2026-09-21", endDate: "2026-09-20" });

    const submit = await renderReadyPage();
    const endDateInput = getDateInput("종료일");

    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(DATE_RANGE_ERROR);
    expect(endDateInput).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(submit);

    expect(document.activeElement).toBe(endDateInput);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
    expectNoContractSideEffects();
  });

  it("asks for a cleared required date only after it held a value, never on first render", async () => {
    await renderReadyPage();
    const endDateInput = getDateInput("종료일");
    expect(screen.queryByText("종료일을 입력해 주세요")).not.toBeInTheDocument();

    fireEvent.change(endDateInput, { target: { value: "" } });

    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent("종료일을 입력해 주세요");
    expect(endDateInput).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps an incomplete visible date as a grey hint while typing and a red error after leaving it", async () => {
    const submit = await renderReadyPage();
    const endDateInput = getDateInput("종료일");

    fireEvent.focus(endDateInput);
    fireEvent.change(endDateInput, { target: { value: "2609" } });

    expect(endDateInput).toHaveValue("2609");
    expect(screen.queryByTestId("contract-creation-date-range-error")).not.toBeInTheDocument();
    expect(screen.getByText("YYYY-MM-DD 형식")).toBeInTheDocument();

    fireEvent.blur(endDateInput);
    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(DATE_FORMAT_ERROR);

    fireEvent.click(submit);
    expect(document.activeElement).toBe(endDateInput);
    expectNoContractSideEffects();
  });

  it("rejects an impossible payment date and preserves the typed, hyphenated value", async () => {
    const submit = await renderReadyPage();
    const paymentDateInput = getDateInput("본인부담금 수령 날짜");

    fireEvent.change(paymentDateInput, { target: { value: "20260231" } });

    expect(paymentDateInput).toHaveValue("2026-02-31");
    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent("존재하지 않는 날짜예요");
    fireEvent.click(submit);
    expect(document.activeElement).toBe(paymentDateInput);
    expectNoContractSideEffects();
  });

  it("re-enables creation after correcting a reversed end date and uses the corrected identity", async () => {
    installFormState({ startDate: "2026-09-21", endDate: "2026-09-20" });
    mockDispatchHeadless.mockResolvedValue({ ok: true, documentId: "doc-1", durationMs: 1 });

    const submit = await renderReadyPage();
    const endDateInput = getDateInput("종료일");
    fireEvent.change(endDateInput, { target: { value: "20260921" } });

    expect(endDateInput).toHaveValue("2026-09-21");
    expect(screen.queryByTestId("contract-creation-date-range-error")).not.toBeInTheDocument();
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    fireEvent.click(await screen.findByRole("button", { name: "고객 정보도 수정" }));
    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      dto: expect.objectContaining({
        name: "테스트 고객",
        phone: "010-1234-5678",
        startDate: "2026-09-21",
        endDate: "2026-09-21",
      }),
    }));
    expect(mockDispatchHeadless).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2026-09-21",
        endDate: "2026-09-21",
      }),
      7,
      expect.any(String),
    );
  });

  it("sends the same payload for a date typed as digits as for the equivalent ISO store value", async () => {
    installFormState({ startDate: "", endDate: "", paymentDate: "2026-09-10" });
    mockDispatchHeadless.mockResolvedValue({ ok: true, documentId: "doc-typed", durationMs: 1 });

    const submit = await renderReadyPage();
    const startDateInput = getDateInput("시작일");
    const endDateInput = getDateInput("종료일");
    expect(startDateInput).toHaveValue("");

    fireEvent.change(startDateInput, { target: { value: "20261201" } });
    fireEvent.change(endDateInput, { target: { value: "20261219" } });
    expect(startDateInput).toHaveValue("2026-12-01");
    expect(endDateInput).toHaveValue("2026-12-19");

    fireEvent.click(submit);
    fireEvent.click(await screen.findByRole("button", { name: "고객 정보도 수정" }));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockDispatchHeadless.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      startDate: "2026-12-01",
      endDate: "2026-12-19",
      contractDuration: "2026-12-01 ~ 2026-12-19",
      startYear: "26", startMonth: "12", startDay: "01",
      endYear: "26", endMonth: "12", endDay: "19",
      paymentYear: "26", paymentMonth: "09", paymentDay: "10",
    }));
  });
});

describe("contract field messages on the customer step", () => {
  const FIELD_PREFIX = "mobile_contracts-new_screen_root_page_root_form-scroll_card_";

  function customerInput(name: "phone-input" | "birthday-input" | "start-date-input"): HTMLInputElement {
    const element = document.querySelector<HTMLInputElement>(`[data-component="${FIELD_PREFIX}${name}"]`);
    if (!element) throw new Error(`missing ${name}`);
    return element;
  }

  async function renderCustomerStep() {
    const { default: ContractCreationPage } = await import("./page");
    render(<ContractCreationPage />);
  }

  function labelRowMessages(): string[] {
    return Array.from(document.querySelectorAll('[data-component$="_label-row"] [data-slot]'))
      .map((element) => element.textContent ?? "");
  }

  it("shows no field message on first render, even for empty required fields", async () => {
    installFormState({
      clientId: null,
      isManualEntry: false,
      name: "",
      phone: "",
      birthday: "",
      startDate: "",
      endDate: "",
      employeeId: null,
      area: "",
    });
    await renderCustomerStep();

    expect(customerInput("phone-input")).toHaveAttribute("placeholder", "010-1234-5678");
    expect(customerInput("birthday-input")).toHaveAttribute("placeholder", "1958-03-03");
    expect(customerInput("start-date-input")).toHaveAttribute("placeholder", "2026-12-01");
    expect(labelRowMessages()).toEqual([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the phone format error in the label row after a partial number is left", async () => {
    installFormState({ phone: "010-1234" });
    await renderCustomerStep();
    const phone = customerInput("phone-input");

    fireEvent.focus(phone);
    expect(screen.getByText("010-1234-5678 형식")).toBeInTheDocument();

    fireEvent.blur(phone);
    const error = screen.getByText("010-1234-5678로 입력해 주세요");
    expect(error.closest('[data-component$="_label-row"]')).not.toBeNull();
    expect(error).toHaveAttribute("aria-live", "polite");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAttribute("aria-describedby", error.id);
  });

  it("reveals the required message and focuses the phone field when next is pressed with it empty", async () => {
    installFormState({ phone: "", clientId: null, isManualEntry: true, name: "새로운 고객" });
    await renderCustomerStep();
    const phone = customerInput("phone-input");
    expect(screen.queryByText("연락처를 입력해 주세요")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByText("연락처를 입력해 주세요")).toBeInTheDocument();
    expect(document.activeElement).toBe(phone);
    expect(mockToast).not.toHaveBeenCalled();
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
