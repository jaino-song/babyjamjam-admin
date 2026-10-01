import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChangeEvent } from "react";

import type { Client } from "@/lib/client/types";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { useFormStore } from "@/stores/form-store";

const mockPush = jest.fn();
const mockStartNavigation = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockToast = jest.fn();
let mockClients: Client[] | undefined = [];
let mockAreaTemplatesData: Array<{ areaId: string; templateName: string | null }> | undefined;
// react-query hands back a stable reference; a fresh array per render would loop the price auto-fill effect.
const mockPriceInfos = [{ duration: 5, fullPrice: "100000", grant: "50000", actualPrice: "50000" }];
const AREA_TEMPLATES = [
  { areaId: "Namdonggu", templateName: "남동구 계약서" },
  { areaId: "Seogu", templateName: "서구 계약서" },
];
const mockVoucherYears = [2026];
const mockNoVoucherPrices: unknown[] = [];

const STORED_START = "2026-09-10";
const STORED_END = calcEndDateBusinessDays(STORED_START, 5) ?? "";
const EMPLOYEE = { id: 11, name: "테스트 제공인력", phone: "01099998888", workArea: [] };
const mockEmployees = [EMPLOYEE];

function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: "테스트 고객",
    phone: "01055556666",
    birthday: "1958-03-03",
    address: "인천시 남동구",
    areaId: "Namdonggu",
    primaryEmployee: { id: EMPLOYEE.id, name: EMPLOYEE.name },
    secondaryEmployee: null,
    type: "A가1형",
    duration: 5,
    fullPrice: "100000",
    grant: "50000",
    actualPrice: "50000",
    startDate: STORED_START,
    endDate: STORED_END,
    dueDate: null,
    birthDate: null,
    eDocId: null,
    ...overrides,
  } as Client;
}

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock("@/hooks", () => ({
  useVoucherYears: () => ({ data: mockVoucherYears }),
  useVoucherPriceInfos: () => ({ data: mockPriceInfos }),
  useAreaTemplates: () => ({ data: mockAreaTemplatesData }),
  useAllVoucherPrices: () => ({ data: mockNoVoucherPrices }),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: mockClients, isError: false, error: null, refetch: jest.fn(), isFetching: false }),
  useCreateClient: () => ({ mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: mockEmployees }),
}));

jest.mock("@/hooks/useEformsign", () => ({
  useEformsign: () => ({ isLoaded: true, openDocument: jest.fn() }),
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
    generateDocument: jest.fn(),
    createDocRecord: jest.fn(),
    adoptDocument: jest.fn(),
  },
}));

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: (props: Record<string, unknown>) => {
    const React = jest.requireActual("react") as typeof import("react");
    const onChange = props.onChange as (id: number | null, client: Client | null) => void;
    const onInputValueChange = props.onInputValueChange as ((value: string) => void) | undefined;
    const onManualEntry = props.onManualEntry as ((query: string) => void) | undefined;
    return React.createElement(
      "div",
      null,
      React.createElement("input", {
        id: props.inputId,
        value: props.inputValue ?? "",
        onChange: (event: ChangeEvent<HTMLInputElement>) => onInputValueChange?.(event.target.value),
      }),
      React.createElement(
        "button",
        { type: "button", onClick: () => onChange(mockClients?.[0]?.id ?? null, mockClients?.[0] ?? null) },
        "기존 고객 선택",
      ),
      React.createElement(
        "button",
        { type: "button", onClick: () => onChange(mockClients?.[1]?.id ?? null, mockClients?.[1] ?? null) },
        "다른 고객 선택",
      ),
      React.createElement("button", { type: "button", onClick: () => onChange(null, null) }, "고객 선택 해제"),
      React.createElement(
        "button",
        { type: "button", onClick: () => onManualEntry?.(String(props.inputValue ?? "")) },
        "직접 입력",
      ),
    );
  },
}));

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: (props: Record<string, unknown>) => {
    const React = jest.requireActual("react") as typeof import("react");
    const onChange = props.onChange as (id: number | null, employee: unknown) => void;
    return React.createElement(
      "button",
      {
        type: "button",
        "data-testid": "employee-autocomplete",
        "data-placeholder": props.placeholder as string | undefined,
        onClick: () => onChange(EMPLOYEE.id, EMPLOYEE),
      },
      "제공인력 선택",
    );
  },
}));

jest.mock("@/components/app/eformsign/HeadlessProgressModal", () => ({
  HeadlessProgressModal: () => null,
}));

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

function field(dataComponent: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-component="${dataComponent}"]`);
  if (!element) throw new Error(`missing ${dataComponent}`);
  return element;
}

const SCREEN = "mobile_contracts-new_screen_root_page_root_form-scroll_";
const areaSelect = () => field(`${SCREEN}area-card_area-select`) as HTMLSelectElement;
const typeSelect = () => field(`${SCREEN}selection-card_type-select`) as HTMLSelectElement;
const durationSelect = () => field(`${SCREEN}selection-card_duration-select`) as HTMLSelectElement;
const primaryPhone = () => field(`${SCREEN}primary-card_primary-phone-input`) as HTMLInputElement;
const emptyOptionText = (select: HTMLSelectElement) => within(select).getAllByRole("option")[0]?.textContent;

const pickClient = () => fireEvent.click(screen.getByRole("button", { name: "기존 고객 선택" }));
const pickOtherClient = () => fireEvent.click(screen.getByRole("button", { name: "다른 고객 선택" }));
const clearClient = () => fireEvent.click(screen.getByRole("button", { name: "고객 선택 해제" }));
const next = () => fireEvent.click(screen.getByRole("button", { name: "다음" }));
const submit = () => fireEvent.click(screen.getByRole("button", { name: "계약서 생성" }));

async function renderPage() {
  const { default: ContractCreationPage } = await import("./page");
  const view = render(<ContractCreationPage />);
  // 목 훅이 읽는 값을 바꾼 뒤 같은 페이지를 다시 그려서 늦게 도착한 데이터를 흉내 내요.
  return { rerenderPage: () => view.rerender(<ContractCreationPage />) };
}

// 계약서 목록의 수정 발송은 보낸 문서에서 prefill을 만들고, 문서에는 계약서 유형이 없어 area를 비워 둬요.
function prefillLikeContractList(client: Client) {
  useFormStore.getState().prefillFromContract({
    clientId: client.id,
    name: client.name,
    phone: client.phone ?? "",
    birthday: client.birthday ?? "",
    address: client.address ?? "",
    employeeId: EMPLOYEE.id,
    employeeName: EMPLOYEE.name,
    employeePhone: EMPLOYEE.phone,
    startDate: (client.startDate ?? "").slice(0, 10),
    endDate: (client.endDate ?? "").slice(0, 10),
    fullPrice: client.fullPrice ?? "",
    grant: client.grant ?? "",
    actualPrice: client.actualPrice ?? "",
    voucherType: client.type ?? "",
    voucherDuration: client.duration != null ? String(client.duration) : "",
  });
}

// 고객 상세의 계약서 발급은 client-detail-controller가 고객의 areaId를 그대로 넘겨요.
function prefillLikeClientDetail(client: Client) {
  prefillLikeContractList(client);
  useFormStore.getState().setArea(client.areaId ?? "");
}

beforeEach(() => {
  jest.clearAllMocks();
  installEventSourceStub();
  mockClients = [makeClient()];
  mockAreaTemplatesData = AREA_TEMPLATES;
  useFormStore.getState().resetAll();
  mockCreateClient.mockResolvedValue({ id: 8 });
  mockUpdateClient.mockResolvedValue({ id: 7 });
  mockDispatchHeadless.mockResolvedValue({ ok: true, documentId: "doc-1", durationMs: 1 });
});

describe("contract form - the stored area is actually selected", () => {
  it("selects it when an existing client is picked from the autocomplete, and 다음 advances without touching it", async () => {
    await renderPage();
    pickClient();

    expect(areaSelect()).toHaveValue("Namdonggu");
    next();
    expect(screen.getByTestId("employee-autocomplete")).toBeInTheDocument();
    expect(screen.queryByText("고객 정보와 계약서를 선택해 주세요")).toBeNull();
  });

  it("selects it when entering from the client detail's 계약서 발급 prefill", async () => {
    prefillLikeClientDetail(makeClient());
    await renderPage();

    expect(areaSelect()).toHaveValue("Namdonggu");
    next();
    expect(screen.getByTestId("employee-autocomplete")).toBeInTheDocument();
  });

  it("selects it when entering from the contract list's 수정 발송 prefill, which carries no area", async () => {
    prefillLikeContractList(makeClient());
    await renderPage();

    expect(useFormStore.getState().area).toBe("Namdonggu");
    expect(areaSelect()).toHaveValue("Namdonggu");
    next();
    expect(screen.getByTestId("employee-autocomplete")).toBeInTheDocument();
  });

  it("selects it once the templates arrive after the client", async () => {
    mockAreaTemplatesData = undefined;
    prefillLikeContractList(makeClient());
    const { rerenderPage } = await renderPage();
    expect(areaSelect()).toHaveValue("");

    mockAreaTemplatesData = AREA_TEMPLATES;
    rerenderPage();
    expect(areaSelect()).toHaveValue("Namdonggu");
  });

  it("selects it once the client list arrives after the prefilled client", async () => {
    mockClients = undefined;
    prefillLikeContractList(makeClient());
    const { rerenderPage } = await renderPage();
    expect(areaSelect()).toHaveValue("");

    mockClients = [makeClient()];
    rerenderPage();
    expect(areaSelect()).toHaveValue("Namdonggu");
  });

  it("does not override a value the user picked by hand when templates or clients refresh", async () => {
    const { rerenderPage } = await renderPage();
    pickClient();
    fireEvent.change(areaSelect(), { target: { value: "Seogu" } });
    expect(areaSelect()).toHaveValue("Seogu");

    mockClients = [makeClient()];
    mockAreaTemplatesData = [...AREA_TEMPLATES];
    rerenderPage();
    expect(areaSelect()).toHaveValue("Seogu");

    fireEvent.change(areaSelect(), { target: { value: "" } });
    mockClients = [makeClient()];
    rerenderPage();
    expect(areaSelect()).toHaveValue("");
  });

  it("applies the new client's area when switching to a different client", async () => {
    mockClients = [makeClient(), makeClient({ id: 8, name: "서구 고객", phone: "01011112222", areaId: "Seogu" })];
    await renderPage();
    pickClient();
    expect(areaSelect()).toHaveValue("Namdonggu");

    pickOtherClient();
    expect(areaSelect()).toHaveValue("Seogu");
  });

  it("drops the previous client's area when the next client's area is not a loaded template", async () => {
    mockClients = [makeClient(), makeClient({ id: 8, name: "다른 고객", phone: "01011112222", areaId: "Unknown" })];
    await renderPage();
    pickClient();
    expect(areaSelect()).toHaveValue("Namdonggu");

    pickOtherClient();
    expect(areaSelect()).toHaveValue("");
  });

  it("clears it when the client is cleared with 선택 해제", async () => {
    await renderPage();
    pickClient();
    expect(areaSelect()).toHaveValue("Namdonggu");

    clearClient();
    expect(areaSelect()).toHaveValue("");
    expect(emptyOptionText(areaSelect())).toBe("선택하세요");
  });

  it("leaves it empty, reading 선택하세요, when the stored area is not among the templates", async () => {
    mockClients = [makeClient({ areaId: "RemovedArea" })];
    await renderPage();
    pickClient();

    expect(areaSelect()).toHaveValue("");
    expect(emptyOptionText(areaSelect())).toBe("선택하세요");
    next();
    expect(screen.queryByTestId("employee-autocomplete")).toBeNull();
  });
});

describe("contract form - empty select options never show a stored value", () => {
  it("reads 선택하세요 for the area, voucher type and duration selects of a stored client", async () => {
    mockClients = [makeClient({ areaId: "RemovedArea" })];
    await renderPage();
    pickClient();
    expect(emptyOptionText(areaSelect())).toBe("선택하세요");
    expect(areaSelect()).not.toHaveClass("storedPlaceholderSelect");

    fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
    next();
    fireEvent.click(screen.getByTestId("employee-autocomplete"));
    next();
    fireEvent.change(typeSelect(), { target: { value: "" } });

    expect(emptyOptionText(typeSelect())).toBe("선택하세요");
    expect(emptyOptionText(durationSelect())).toBe("선택하세요");
    expect(typeSelect()).toHaveValue("");
    expect(durationSelect()).toHaveValue("");
  });
});

describe("contract form - employee phone on the provider step", () => {
  it("shows the prefilled phone hyphenated, shows a picked employee's phone hyphenated, and still submits the raw number", async () => {
    prefillLikeClientDetail(makeClient());
    await renderPage();
    next();

    expect(primaryPhone()).toHaveValue("010-9999-8888");
    fireEvent.click(screen.getByTestId("employee-autocomplete"));
    expect(primaryPhone()).toHaveValue("010-9999-8888");
    expect(useFormStore.getState().employeePhone).toBe("01099998888");

    next();
    next();
    submit();

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockDispatchHeadless.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ caretaker1Contact: "01099998888" }),
    );
  });
});
