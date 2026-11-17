import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
const mockSelectClient = jest.fn();
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
    mockSelectClient.mockImplementation(props.onChange as (id: number | null, client: Client | null) => void);
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

jest.mock("lucide-react", () => ({
  ...jest.requireActual<typeof import("lucide-react")>("lucide-react"),
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

beforeEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockUseFormStore.mockReset();
  installEventSourceStub();
  installFormState();
  mockCreateClient.mockResolvedValue({ id: 8 });
  mockUpdateClient.mockResolvedValue({ id: 7 });
  mockCreateDocRecord.mockResolvedValue({ id: 21, documentId: "doc-iframe" });
  mockAdoptDocument.mockResolvedValue({ documentId: "doc-adopted" });
  mockGenerateDocument.mockResolvedValue({ mode: { type: "01" } });
  mockSupersedeDocument.mockResolvedValue(undefined);
});

it("preserves the contract creation button while announcing a pending request only through its Spinner", async () => {
  const pending = deferred<unknown>();
  mockDispatchHeadless.mockReturnValue(pending.promise);
  const submit = await renderReadyPage();
  expect(submit).toHaveClass("wizardButton", "primaryButton");
  expect(submit).not.toHaveAttribute("aria-busy");
  fireEvent.click(submit);
  await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
  const busy = screen.getByRole("button", { name: "생성 중" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveAttribute("data-loading", "");
  expect(busy).toHaveClass("wizardButton", "primaryButton", "relative");
  expect(busy.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).not.toBeNull();
  const idle = busy.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent("계약서 생성");
  await act(async () => { pending.resolve({ ok: true, documentId: "qa-document" }); await pending.promise; });
});
