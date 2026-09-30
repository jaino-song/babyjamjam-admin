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
// react-query hands back a stable reference; a fresh array per render would loop the price auto-fill effect.
const mockPriceInfos = [{ duration: 5, fullPrice: "100000", grant: "50000", actualPrice: "50000" }];
const mockAreaTemplates = [
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
  useAreaTemplates: () => ({ data: mockAreaTemplates }),
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

const DIFF_HINT = "등록된 정보와 달라요.";
const DIFF_TITLE = "고객 정보와 다른 내용이 있어요";
const CONTRACT_ONLY = "계약서에만 반영";
const UPDATE_CLIENT = "고객 정보도 수정";
const PERIOD_LOCKED_NOTE = "서비스 기록이 확정된 고객이라 계약 기간은 계약서에만 반영돼요.";

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

function labelRow(fieldName: string): HTMLElement {
  return field(`${fieldName}_label-row`);
}

function hintIn(fieldName: string): HTMLElement | null {
  return labelRow(fieldName).querySelector('[data-slot="registered-value-diff-hint"]');
}

function errorIn(fieldName: string): HTMLElement | null {
  return labelRow(fieldName).querySelector('[data-slot="field-error-message"]');
}

const PHONE_FIELD = "mobile_contracts-new_client_phone-field";
const BIRTHDAY_FIELD = "mobile_contracts-new_client_birthday-field";
const ADDRESS_FIELD = "mobile_contracts-new_client_address-field";
const AREA_FIELD = "mobile_contracts-new_client_area-field";
const START_FIELD = "mobile_contracts-new_review_start-date-field";
const END_FIELD = "mobile_contracts-new_review_end-date-field";

function input(name: string): HTMLInputElement {
  return field(`mobile_contracts-new_screen_root_page_root_form-scroll_${name}`) as HTMLInputElement;
}

const phoneInput = () => input("card_phone-input");
const addressInput = () => input("card_address-input");
const areaSelect = () => input("area-card_area-select") as unknown as HTMLSelectElement;

function next() {
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
}

function selectStoredClient() {
  fireEvent.click(screen.getByRole("button", { name: "기존 고객 선택" }));
  fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
}

async function renderPage() {
  const { default: ContractCreationPage } = await import("./page");
  render(<ContractCreationPage />);
}

async function renderOnStep(step: 0 | 3, options: { pickClient?: boolean } = {}) {
  await renderPage();
  if (options.pickClient !== false) selectStoredClient();
  for (let i = 0; i < step; i += 1) next();
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "계약서 생성" }));
}

function getUpdateDto(): Record<string, unknown> {
  const call = mockUpdateClient.mock.calls[0]?.[0] as { dto: Record<string, unknown> } | undefined;
  if (!call) throw new Error("client was not updated");
  return call.dto;
}

beforeEach(() => {
  jest.clearAllMocks();
  installEventSourceStub();
  mockClients = [makeClient()];
  useFormStore.getState().resetAll();
  mockCreateClient.mockResolvedValue({ id: 8 });
  mockUpdateClient.mockResolvedValue({ id: 7 });
  mockDispatchHeadless.mockResolvedValue({ ok: true, documentId: "doc-1", durationMs: 1 });
});

describe("mobile contract form - registered-value hints and stored placeholders", () => {
  it("shows the hint at the right of the phone label row only while it differs from the stored number", async () => {
    await renderOnStep(0);

    expect(phoneInput()).toHaveValue("010-5555-6666");
    expect(hintIn(PHONE_FIELD)).toBeNull();

    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    const hint = hintIn(PHONE_FIELD);
    expect(hint).toHaveTextContent(DIFF_HINT);
    expect(hint).toHaveClass("helper_ok");
    expect(phoneInput()).toHaveAttribute("aria-describedby", hint?.id);

    fireEvent.change(phoneInput(), { target: { value: "01055556666" } });
    expect(hintIn(PHONE_FIELD)).toBeNull();
    expect(phoneInput()).not.toHaveAttribute("aria-describedby");
  });

  it("shows the stored value as the placeholder, with no hint, when a prefilled input is cleared", async () => {
    await renderOnStep(0);

    fireEvent.change(phoneInput(), { target: { value: "" } });
    fireEvent.change(addressInput(), { target: { value: "" } });

    expect(phoneInput()).toHaveAttribute("placeholder", "010-5555-6666");
    expect(addressInput()).toHaveAttribute("placeholder", "인천시 남동구");
    expect(hintIn(PHONE_FIELD)).toBeNull();
    expect(hintIn(ADDRESS_FIELD)).toBeNull();
  });

  it("uses the stored area as the empty select's label and hints once a different area is picked", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "기존 고객 선택" }));

    expect(areaSelect()).toHaveValue("");
    expect(within(areaSelect()).getAllByRole("option")[0]).toHaveTextContent("남동구");
    expect(areaSelect()).toHaveClass("storedPlaceholderSelect");
    expect(hintIn(AREA_FIELD)).toBeNull();

    fireEvent.change(areaSelect(), { target: { value: "Seogu" } });
    expect(hintIn(AREA_FIELD)).toHaveTextContent(DIFF_HINT);
  });

  it("does not hint on a field the stored client left empty", async () => {
    mockClients = [makeClient({ address: null })];
    await renderOnStep(0);

    fireEvent.change(addressInput(), { target: { value: "서울시 강남구" } });

    expect(hintIn(ADDRESS_FIELD)).toBeNull();
    expect(addressInput()).toHaveAttribute("placeholder", "서울시 강남구...");
  });

  it("shows no hints and the original placeholders for a new client and after the client is cleared", async () => {
    await renderPage();
    expect(phoneInput()).toHaveAttribute("placeholder", "010-1234-5678");

    fireEvent.click(screen.getByRole("button", { name: "기존 고객 선택" }));
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    expect(hintIn(PHONE_FIELD)).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "고객 선택 해제" }));
    fireEvent.change(phoneInput(), { target: { value: "" } });
    expect(phoneInput()).toHaveAttribute("placeholder", "010-1234-5678");
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    expect(hintIn(PHONE_FIELD)).toBeNull();
  });

  it("hints on staff only when the stored client had one and shows the stored name as the placeholder", async () => {
    await renderOnStep(0);
    next();

    expect(screen.getByTestId("employee-autocomplete")).toHaveAttribute("data-placeholder", EMPLOYEE.name);
    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();
  });

  it("hints on the contract dates and keeps the stored date as placeholder on the period step", async () => {
    await renderOnStep(3);

    expect(hintIn(START_FIELD)).toBeNull();
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "260911" } });
    expect(hintIn(START_FIELD)).toHaveTextContent(DIFF_HINT);
    expect(hintIn(END_FIELD)).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/종료일/), { target: { value: "" } });
    expect(hintIn(END_FIELD)).toBeNull();
    expect(screen.getByLabelText(/종료일/)).toHaveAttribute(
      "placeholder",
      `${STORED_END.slice(2, 4)}${STORED_END.slice(5, 7)}${STORED_END.slice(8, 10)}`,
    );
  });
});

describe("mobile contract form - validation messages share the label-row slot", () => {
  it("swaps the green end-date hint for the red format error and back, without role=alert", async () => {
    await renderOnStep(3);
    const endInput = screen.getByLabelText(/종료일/);

    fireEvent.change(endInput, { target: { value: "260930" } });
    expect(hintIn(END_FIELD)).not.toBeNull();
    expect(errorIn(END_FIELD)).toBeNull();

    fireEvent.change(endInput, { target: { value: "2609" } });
    const error = errorIn(END_FIELD);
    expect(error).toHaveTextContent("종료일은 6자리(YYMMDD) 형식의 유효한 날짜를 입력해 주세요.");
    expect(error).toHaveClass("helper_err");
    expect(error).toHaveAttribute("data-testid", "contract-creation-date-range-error");
    expect(error).not.toHaveAttribute("role");
    expect(error).toHaveAttribute("aria-live", "polite");
    expect(hintIn(END_FIELD)).toBeNull();
    expect(endInput).toHaveAttribute("aria-invalid", "true");
    expect(endInput).toHaveAttribute("aria-describedby", error?.id);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(endInput, { target: { value: "260930" } });
    expect(errorIn(END_FIELD)).toBeNull();
    expect(hintIn(END_FIELD)).not.toBeNull();
    expect(endInput).not.toHaveAttribute("aria-invalid");
  });

  it("shows the birthday format error in red instead of the hint, and the hint again once valid", async () => {
    await renderOnStep(0);
    const birthday = input("card_birthday-input");

    fireEvent.change(birthday, { target: { value: "1958-04-04" } });
    expect(hintIn(BIRTHDAY_FIELD)).not.toBeNull();

    fireEvent.change(birthday, { target: { value: "1958-13" } });
    const error = errorIn(BIRTHDAY_FIELD);
    expect(error).toHaveTextContent("생년월일을 YYYY-MM-DD 형식으로 입력해 주세요");
    expect(hintIn(BIRTHDAY_FIELD)).toBeNull();
    expect(birthday).toHaveAttribute("aria-invalid", "true");
    expect(birthday).toHaveAttribute("aria-describedby", error?.id);

    fireEvent.change(birthday, { target: { value: "1958-04-04" } });
    expect(errorIn(BIRTHDAY_FIELD)).toBeNull();
    expect(hintIn(BIRTHDAY_FIELD)).not.toBeNull();
  });
});

describe("mobile contract form - confirm before writing form edits back to the client", () => {
  it("lists the changed phone and, for 계약서에만 반영, dispatches with the new phone without updating the client", async () => {
    await renderOnStep(0);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    submit();

    const dialog = await screen.findByRole("dialog", { name: DIFF_TITLE });
    expect(dialog).toHaveTextContent("계약서에 입력한 내용이 저장된 고객 정보와 달라요. 고객 정보도 함께 수정할까요?");
    const row = within(dialog).getByText("연락처").parentElement as HTMLElement;
    expect(row.querySelector("del")).toHaveTextContent("010-5555-6666");
    expect(row.querySelector("strong")).toHaveTextContent("010-9999-0000");
    expect(within(dialog).queryByText("주소")).toBeNull();
    expect(mockUpdateClient).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: CONTRACT_ONLY }));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).not.toHaveBeenCalled();
    expect(mockDispatchHeadless.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ customerContact: "010-9999-0000" }));
    expect(mockDispatchHeadless.mock.calls[0]?.[1]).toBe(7);
  });

  it("updates the client with the new phone and then dispatches for 고객 정보도 수정", async () => {
    await renderOnStep(0);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    submit();

    fireEvent.click(within(await screen.findByRole("dialog", { name: DIFF_TITLE })).getByRole("button", { name: UPDATE_CLIENT }));

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(mockUpdateClient.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      id: 7,
      dto: expect.objectContaining({ phone: "010-9999-0000", startDate: STORED_START, endDate: STORED_END }),
    }));
    expect(mockUpdateClient.mock.invocationCallOrder[0]).toBeLessThan(mockDispatchHeadless.mock.invocationCallOrder[0] ?? 0);
  });

  it("does not ask, and skips the no-op client update, when nothing differs", async () => {
    await renderOnStep(3);
    submit();

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("persists only the staff assignment for 계약서에만 반영 when the stored client has no primary employee", async () => {
    mockClients = [makeClient({ primaryEmployee: null })];
    await renderOnStep(0);
    next();
    fireEvent.click(screen.getByTestId("employee-autocomplete"));
    next(); next();
    submit();

    const dialog = await screen.findByRole("dialog", { name: DIFF_TITLE });
    expect(within(dialog).getByText("제공인력 1")).toBeInTheDocument();
    expect(within(dialog).getByText("(없음)")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: CONTRACT_ONLY }));

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: 7,
      dto: { primaryEmployeeId: EMPLOYEE.id, secondaryEmployeeId: null },
    });
  });

  it("leaves the period out of the client update for a finalized client and says so in the dialog", async () => {
    mockClients = [makeClient({ serviceRecordPeriodLocked: true })];
    await renderOnStep(0);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "260911" } });
    submit();

    const dialog = await screen.findByRole("dialog", { name: DIFF_TITLE });
    expect(within(dialog).getByText("시작일")).toBeInTheDocument();
    expect(within(dialog).getByText(PERIOD_LOCKED_NOTE)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: UPDATE_CLIENT }));

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    const dto = getUpdateDto();
    expect(dto).toEqual(expect.objectContaining({ phone: "010-9999-0000" }));
    expect(dto).not.toHaveProperty("startDate");
    expect(dto).not.toHaveProperty("endDate");
    expect(dto).not.toHaveProperty("duration");
    expect(mockDispatchHeadless.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ startDate: "2026-09-11" }));
  });

  it("omits the period note when a finalized client's period is unchanged", async () => {
    mockClients = [makeClient({ serviceRecordPeriodLocked: true })];
    await renderOnStep(0);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    submit();

    const dialog = await screen.findByRole("dialog", { name: DIFF_TITLE });
    expect(within(dialog).queryByText(PERIOD_LOCKED_NOTE)).toBeNull();
  });

  it("sends nothing when the dialog is dismissed and lets the user submit again", async () => {
    await renderOnStep(0);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    submit();

    const dialog = await screen.findByRole("dialog", { name: DIFF_TITLE });
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mockUpdateClient).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "계약서 생성" })).not.toBeDisabled());
  });

  it("asks after the existing-contract confirmation and never shows both modals at once", async () => {
    mockClients = [makeClient({ eDocId: "doc-existing" })];
    await renderOnStep(0);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    submit();

    const existing = await screen.findByRole("dialog", { name: "계약서 재생성 확인" });
    expect(screen.queryByRole("dialog", { name: DIFF_TITLE })).toBeNull();
    expect(mockUpdateClient).not.toHaveBeenCalled();

    fireEvent.click(within(existing).getByRole("button", { name: "생성" }));
    await screen.findByRole("dialog", { name: DIFF_TITLE });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "계약서 재생성 확인" })).toBeNull());
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("does not ask again when the same values are resubmitted after 계약서에만 반영", async () => {
    mockDispatchHeadless
      .mockResolvedValueOnce({ ok: false, reason: "template_workflow_config_unavailable", failedStep: "client-started", durationMs: 1 })
      .mockResolvedValueOnce({ ok: true, documentId: "doc-retried", durationMs: 1 });
    await renderOnStep(0);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    submit();
    fireEvent.click(within(await screen.findByRole("dialog", { name: DIFF_TITLE })).getByRole("button", { name: CONTRACT_ONLY }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이번 요청에서 계약서를 발송하지 않았어요."));
    await waitFor(() => expect(screen.getByRole("button", { name: "계약서 생성" })).not.toBeDisabled());
    submit();

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("never asks for a new client that is auto-registered in the same submit", async () => {
    await renderPage();
    fireEvent.change(document.getElementById("contract-create-client-name") as HTMLInputElement, {
      target: { value: "새로운 고객" },
    });
    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    fireEvent.change(phoneInput(), { target: { value: "01012341234" } });
    fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();
    expect(phoneInput()).toHaveAttribute("placeholder", "010-1234-5678");
    next();
    fireEvent.click(screen.getByTestId("employee-autocomplete"));
    next();
    fireEvent.change(field("mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_type-select"), {
      target: { value: "A가1형" },
    });
    fireEvent.change(field("mobile_contracts-new_screen_root_page_root_form-scroll_selection-card_duration-select"), {
      target: { value: "5" },
    });
    next();
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "260910" } });
    submit();

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });
});

// 고객 상세의 "계약서 생성"은 client-detail-controller가 prefillFromContract로 스토어를 채운 뒤 이 페이지로 와요.
// 고객 선택 핸들러를 거치지 않으니 저장값은 /clients 목록의 고객 레코드에서 읽어야 해요.
describe("mobile contract form - entering with a prefilled store (client detail)", () => {
  function prefillLikeClientDetail(client: Client) {
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
      area: "",
    });
  }

  it("shows no hint until a value really differs, even though the prefill reset the area and reformatted the dates", async () => {
    // 저장값은 타임스탬프 형식이고, 프리필은 날짜만 남기고 area는 비워요.
    mockClients = [makeClient({ startDate: `${STORED_START}T00:00:00.000Z`, endDate: `${STORED_END}T00:00:00.000Z` })];
    prefillLikeClientDetail(mockClients[0] as Client);
    await renderPage();

    expect(phoneInput()).toHaveValue("010-5555-6666");
    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();
    expect(areaSelect()).toHaveValue("");
    expect(within(areaSelect()).getAllByRole("option")[0]).toHaveTextContent("남동구");

    fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();
    next(); next(); next();
    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();

    submit();
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("hints on a changed phone, asks on submit, and 계약서에만 반영 skips the client update", async () => {
    prefillLikeClientDetail(makeClient());
    await renderPage();
    fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    expect(hintIn(PHONE_FIELD)).toHaveTextContent(DIFF_HINT);
    next(); next(); next();
    submit();

    const dialog = await screen.findByRole("dialog", { name: DIFF_TITLE });
    expect(within(dialog).getByText("연락처")).toBeInTheDocument();
    expect(within(dialog).queryByText("제공인력 1")).toBeNull();
    expect(mockUpdateClient).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: CONTRACT_ONLY }));

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).not.toHaveBeenCalled();
    expect(mockDispatchHeadless.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ customerContact: "010-9999-0000" }));
  });

  it("takes the finalized flag from the client record, not from the prefilled form values", async () => {
    mockClients = [makeClient({ serviceRecordPeriodLocked: true })];
    prefillLikeClientDetail(mockClients[0] as Client);
    await renderPage();
    fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    next(); next(); next();
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "260911" } });
    submit();

    fireEvent.click(within(await screen.findByRole("dialog", { name: DIFF_TITLE })).getByRole("button", { name: UPDATE_CLIENT }));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    const dto = getUpdateDto();
    expect(dto).toEqual(expect.objectContaining({ phone: "010-9999-0000" }));
    expect(dto).not.toHaveProperty("startDate");
    expect(dto).not.toHaveProperty("duration");
  });

  it("waits for the client list, then hints once the record arrives", async () => {
    mockClients = undefined;
    prefillLikeClientDetail(makeClient());
    const { default: ContractCreationPage } = await import("./page");
    const view = render(<ContractCreationPage />);
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    expect(hintIn(PHONE_FIELD)).toBeNull();

    mockClients = [makeClient()];
    view.rerender(<ContractCreationPage />);
    expect(hintIn(PHONE_FIELD)).toHaveTextContent(DIFF_HINT);
  });

  it("falls back to the plain update when the client is not in the list at all", async () => {
    mockClients = [];
    prefillLikeClientDetail(makeClient());
    await renderPage();
    fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
    fireEvent.change(phoneInput(), { target: { value: "01099990000" } });
    expect(hintIn(PHONE_FIELD)).toBeNull();
    next(); next(); next();
    submit();

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
  });
});
