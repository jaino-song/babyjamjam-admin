import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChangeEvent } from "react";

import type { Client } from "@/lib/client/types";
import { useBusinessDayCalendar, type UseBusinessDayCalendarResult } from "@/hooks/useBusinessDayCalendar";
import {
  calcEndDateBusinessDays,
  createKrBusinessDayCalendar,
  getKoreanHolidays,
  KR_BUILTIN_CALENDAR,
} from "@/lib/date/business-days";
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

jest.mock("@/hooks/useBusinessDayCalendar");

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

function formatHintIn(fieldName: string): HTMLElement | null {
  return labelRow(fieldName).querySelector('[data-slot="field-hint-message"]');
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

// Calls the element's React onClick directly, so the test reaches the handler even though the
// (disabled) button would swallow a real click.
function invokeReactClick(element: HTMLElement): void {
  const propsKey = Object.keys(element).find((key) => key.startsWith("__reactProps$"));
  const onClick = (element as unknown as Record<string, { onClick?: () => void }>)[propsKey ?? ""]?.onClick;
  if (!onClick) throw new Error("element has no React onClick");
  act(() => onClick());
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
    expect(hint).toHaveClass("tone_ok");
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

  it("selects the stored area for real, keeps the empty option as 선택하세요, and hints once a different area is picked", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "기존 고객 선택" }));

    expect(areaSelect()).toHaveValue("Namdonggu");
    expect(within(areaSelect()).getAllByRole("option")[0]).toHaveTextContent("선택하세요");
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
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "20260911" } });
    expect(hintIn(START_FIELD)).toHaveTextContent(DIFF_HINT);
    expect(hintIn(END_FIELD)).not.toBeNull();

    fireEvent.change(screen.getByLabelText(/종료일/), { target: { value: "" } });
    expect(hintIn(END_FIELD)).toBeNull();
    expect(screen.getByLabelText(/종료일/)).toHaveAttribute("placeholder", STORED_END);
  });
});

describe("mobile contract form - validation messages share the label-row slot", () => {
  it("swaps the green end-date hint for the grey format hint, then the red error after leaving, without role=alert", async () => {
    await renderOnStep(3);
    const endInput = screen.getByLabelText(/종료일/);

    fireEvent.change(endInput, { target: { value: "20260930" } });
    expect(endInput).toHaveValue("2026-09-30");
    expect(hintIn(END_FIELD)).not.toBeNull();
    expect(errorIn(END_FIELD)).toBeNull();

    fireEvent.focus(endInput);
    fireEvent.change(endInput, { target: { value: "2609" } });
    expect(formatHintIn(END_FIELD)).toHaveTextContent("YYYY-MM-DD 형식");
    expect(errorIn(END_FIELD)).toBeNull();
    expect(endInput).not.toHaveAttribute("aria-invalid");

    fireEvent.blur(endInput);
    const error = errorIn(END_FIELD);
    expect(error).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
    expect(error).toHaveClass("tone_error");
    expect(error).toHaveAttribute("data-testid", "contract-creation-date-range-error");
    expect(error).not.toHaveAttribute("role");
    expect(error).toHaveAttribute("aria-live", "polite");
    expect(hintIn(END_FIELD)).toBeNull();
    expect(formatHintIn(END_FIELD)).toBeNull();
    expect(endInput).toHaveAttribute("aria-invalid", "true");
    expect(endInput).toHaveAttribute("aria-describedby", error?.id);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(endInput, { target: { value: "20260930" } });
    expect(errorIn(END_FIELD)).toBeNull();
    expect(hintIn(END_FIELD)).not.toBeNull();
    expect(endInput).not.toHaveAttribute("aria-invalid");
  });

  it("shows a grey format hint while the birthday is being typed and the red error once it is left", async () => {
    await renderOnStep(0);
    const birthday = input("card_birthday-input");

    fireEvent.change(birthday, { target: { value: "19580404" } });
    expect(birthday).toHaveValue("1958-04-04");
    expect(hintIn(BIRTHDAY_FIELD)).not.toBeNull();

    fireEvent.focus(birthday);
    fireEvent.change(birthday, { target: { value: "195813" } });
    expect(birthday).toHaveValue("1958-13");
    expect(formatHintIn(BIRTHDAY_FIELD)).toHaveTextContent("YYYY-MM-DD 형식");
    expect(errorIn(BIRTHDAY_FIELD)).toBeNull();

    fireEvent.blur(birthday);
    const error = errorIn(BIRTHDAY_FIELD);
    expect(error).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
    expect(hintIn(BIRTHDAY_FIELD)).toBeNull();
    expect(birthday).toHaveAttribute("aria-invalid", "true");
    expect(birthday).toHaveAttribute("aria-describedby", error?.id);

    fireEvent.change(birthday, { target: { value: "19580404" } });
    expect(errorIn(BIRTHDAY_FIELD)).toBeNull();
    expect(hintIn(BIRTHDAY_FIELD)).not.toBeNull();
  });

  it("rejects a birthday that does not exist or lies in the future with a short message", async () => {
    await renderOnStep(0);
    const birthday = input("card_birthday-input");

    fireEvent.change(birthday, { target: { value: "19580231" } });
    expect(errorIn(BIRTHDAY_FIELD)).toHaveTextContent("존재하지 않는 날짜예요");

    fireEvent.change(birthday, { target: { value: "29990101" } });
    expect(errorIn(BIRTHDAY_FIELD)).toHaveTextContent("미래 날짜는 입력할 수 없어요");
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
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "20260911" } });
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
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "20260910" } });
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
      employee2Id: client.secondaryEmployee?.id ?? null,
      employee2Name: client.secondaryEmployee?.name ?? "",
      employee2Phone: client.secondaryEmployee?.phone ?? "",
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

  it("shows no hint until a value really differs, even though the prefill reformatted the dates", async () => {
    // 저장값은 타임스탬프 형식이고, 프리필은 날짜만 남겨요. 계약서 유형은 저장된 값이 그대로 선택돼요.
    mockClients = [makeClient({ startDate: `${STORED_START}T00:00:00.000Z`, endDate: `${STORED_END}T00:00:00.000Z` })];
    prefillLikeClientDetail(mockClients[0] as Client);
    await renderPage();

    expect(phoneInput()).toHaveValue("010-5555-6666");
    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();
    expect(areaSelect()).toHaveValue("Namdonggu");
    expect(within(areaSelect()).getAllByRole("option")[0]).toHaveTextContent("선택하세요");

    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();
    next(); next(); next();
    expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();

    submit();
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("keeps the stored secondary staff, so an unchanged client is neither asked about nor updated", async () => {
    const secondEmployee = { id: 12, name: "두번째 제공인력", phone: "01077776666", workArea: [] };
    mockEmployees.push(secondEmployee);
    try {
      mockClients = [makeClient({ secondaryEmployee: { id: secondEmployee.id, name: secondEmployee.name, phone: secondEmployee.phone } })];
      prefillLikeClientDetail(mockClients[0] as Client);
      await renderPage();

      expect(useFormStore.getState().employee2Id).toBe(secondEmployee.id);
      expect(useFormStore.getState().showEmployee2).toBe(true);
      fireEvent.change(areaSelect(), { target: { value: "Namdonggu" } });
      next(); next(); next();
      expect(document.querySelector('[data-slot="registered-value-diff-hint"]')).toBeNull();

      submit();
      await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(mockUpdateClient).not.toHaveBeenCalled();
    } finally {
      mockEmployees.pop();
    }
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
    fireEvent.change(screen.getByLabelText(/시작일/), { target: { value: "20260911" } });
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

describe("mobile contract form - branch holiday calendar", () => {
  const mockedCalendarHook = jest.mocked(useBusinessDayCalendar);
  // The branch closes Friday 2026-09-11, inside the stored client's 5-business-day period.
  const branchCalendar = (version: string) =>
    createKrBusinessDayCalendar([...getKoreanHolidays(2026), "2026-09-11"], {
      version,
      supportedYears: [2026],
    });
  const BRANCH_CALENDAR = branchCalendar("kr-db-branch");
  const BRANCH_END = BRANCH_CALENDAR.calcEndDateBusinessDays(STORED_START, 5);

  const calendarResult = (overrides: Partial<UseBusinessDayCalendarResult> = {}): UseBusinessDayCalendarResult => {
    const calendar = overrides.calendar ?? BRANCH_CALENDAR;
    return { calendar, ready: true, error: null, retry: jest.fn(), version: calendar.version, ...overrides };
  };
  const endDateInput = () => input("period-card_end-date-input");

  async function renderOnPeriodStep() {
    const { default: ContractCreationPage } = await import("./page");
    const view = render(<ContractCreationPage />);
    const rerender = () => view.rerender(<ContractCreationPage />);
    selectStoredClient();
    for (let i = 0; i < 3; i += 1) next();
    return { rerender };
  }

  beforeEach(() => {
    mockedCalendarHook.mockReturnValue(calendarResult());
  });

  afterEach(() => {
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: KR_BUILTIN_CALENDAR }));
  });

  // A start date inside the branch-closed week, so the branch result differs from the built-in one.
  const EDITED_START = "2026-09-09";
  const BRANCH_EDITED_END = BRANCH_CALENDAR.calcEndDateBusinessDays(EDITED_START, 5);
  const startDateInput = () => input("period-card_start-date-input");

  it("moves the calculated end date by the branch-added holiday once the start date is edited", async () => {
    expect(BRANCH_EDITED_END).not.toBe(KR_BUILTIN_CALENDAR.calcEndDateBusinessDays(EDITED_START, 5));

    await renderOnPeriodStep();
    fireEvent.change(startDateInput(), { target: { value: EDITED_START } });

    await waitFor(() => expect(endDateInput()).toHaveValue(BRANCH_EDITED_END));
  });

  it("calculates an edit made while the calendar loads once when it becomes ready, not while it loads", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ ready: false, calendar: KR_BUILTIN_CALENDAR }));
    const { rerender } = await renderOnPeriodStep();
    fireEvent.change(startDateInput(), { target: { value: EDITED_START } });

    expect(endDateInput()).toHaveValue(STORED_END);
    expect(screen.getByText("공휴일 정보를 불러오는 중이에요…")).toBeInTheDocument();

    mockedCalendarHook.mockReturnValue(calendarResult());
    rerender();

    await waitFor(() => expect(endDateInput()).toHaveValue(BRANCH_EDITED_END));
  });

  it("keeps a manual end date when the calendar reloads without the dates changing", async () => {
    const { rerender } = await renderOnPeriodStep();
    expect(endDateInput()).toHaveValue(STORED_END);

    fireEvent.change(endDateInput(), { target: { value: "2026-10-30" } });
    expect(endDateInput()).toHaveValue("2026-10-30");

    mockedCalendarHook.mockReturnValue(calendarResult({ ready: false }));
    rerender();
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: branchCalendar("kr-db-branch-2") }));
    rerender();

    expect(endDateInput()).toHaveValue("2026-10-30");
  });

  it("disables 계약서 생성 and does not submit until the calendar is ready", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ ready: false, calendar: KR_BUILTIN_CALENDAR }));
    const { rerender } = await renderOnPeriodStep();

    const submitButton = screen.getByRole("button", { name: "계약서 생성" });
    expect(submitButton).toBeDisabled();
    fireEvent.click(submitButton);
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
    expect(mockUpdateClient).not.toHaveBeenCalled();

    mockedCalendarHook.mockReturnValue(calendarResult());
    rerender();
    expect(screen.getByRole("button", { name: "계약서 생성" })).toBeEnabled();
  });

  it("shows the no-branch notice next to the period and blocks submitting", async () => {
    mockedCalendarHook.mockReturnValue(
      calendarResult({ ready: false, error: "no-branch", calendar: KR_BUILTIN_CALENDAR }),
    );
    await renderOnPeriodStep();

    expect(screen.getByText("지점을 선택한 뒤 다시 시도해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계약서 생성" })).toBeDisabled();
  });

  it("asks the calendar hook for the years of the form dates", async () => {
    await renderOnPeriodStep();

    const lastCall = mockedCalendarHook.mock.calls.at(-1)?.[0];
    expect(lastCall?.extraYears).toEqual(expect.arrayContaining([2026, 2027]));
  });

  describe("a period that reaches a year the calendar does not support", () => {
    const UNSUPPORTED_YEAR_NOTICE = "이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요.";
    // 2028 has not been synced for the branch yet: any calculation reaching it throws.
    const UNSUPPORTED_2028_CALENDAR = createKrBusinessDayCalendar(
      [...getKoreanHolidays(2026), ...getKoreanHolidays(2027)],
      { version: "kr-db-unsupported-2028", supportedYears: [2026, 2027] },
    );

    beforeEach(() => {
      mockedCalendarHook.mockReturnValue(calendarResult({ calendar: UNSUPPORTED_2028_CALENDAR }));
    });

    it("clears the stale end date, shows the notice and blocks submit, then recovers on a supported start date", async () => {
      await renderOnPeriodStep();
      await waitFor(() => expect(endDateInput()).toHaveValue(STORED_END));
      expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();

      // 5 business days from 2027-12-30 reach 2028.
      fireEvent.change(startDateInput(), { target: { value: "2027-12-30" } });

      await waitFor(() => expect(endDateInput()).toHaveValue(""));
      expect(screen.getByText(UNSUPPORTED_YEAR_NOTICE)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "계약서 생성" })).toBeDisabled();
      submit();
      expect(mockDispatchHeadless).not.toHaveBeenCalled();
      expect(mockUpdateClient).not.toHaveBeenCalled();

      fireEvent.change(startDateInput(), { target: { value: STORED_START } });

      await waitFor(() => expect(endDateInput()).toHaveValue(STORED_END));
      expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "계약서 생성" })).toBeEnabled();
    });

    it("keeps the submit handler itself closed for an unsupported year, even with an end date present", async () => {
      await renderOnPeriodStep();
      fireEvent.change(startDateInput(), { target: { value: "2027-12-30" } });
      await screen.findByText(UNSUPPORTED_YEAR_NOTICE);
      // A complete end date that did not come from the end-date input keeps the unsupported flag set.
      act(() => {
        useFormStore.getState().setEndDate("2028-01-07");
      });
      const submitButton = screen.getByRole("button", { name: "계약서 생성" });
      expect(submitButton).toBeDisabled();

      // The button is disabled, so a real click never reaches the handler; call it directly.
      invokeReactClick(submitButton);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Past the guard the form would open the "고객 정보와 다른 내용이 있어요" confirmation (or dispatch).
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(mockDispatchHeadless).not.toHaveBeenCalled();
      expect(mockUpdateClient).not.toHaveBeenCalled();
    });

    it("drops the notice once the user types an end date", async () => {
      await renderOnPeriodStep();
      fireEvent.change(startDateInput(), { target: { value: "2027-12-30" } });
      await screen.findByText(UNSUPPORTED_YEAR_NOTICE);

      fireEvent.change(endDateInput(), { target: { value: "2028-01-07" } });

      expect(endDateInput()).toHaveValue("2028-01-07");
      expect(screen.queryByText(UNSUPPORTED_YEAR_NOTICE)).not.toBeInTheDocument();
    });
  });
});

describe("mobile contract form - a picked client keeps its stored end date", () => {
  const mockedCalendarHook = jest.mocked(useBusinessDayCalendar);
  // The branch closes Monday 2026-09-14, so 2026-09-07 + 15 business days is 2026-09-30 here
  // while the stored client says 2026-09-29.
  const BRANCH_CALENDAR = createKrBusinessDayCalendar([...getKoreanHolidays(2026), "2026-09-14"], {
    version: "kr-db-keep-end",
    supportedYears: [2026, 2027],
  });
  const KEEP_START = "2026-09-07";
  const KEEP_END = "2026-09-29";
  const calendarResult = (overrides: Partial<UseBusinessDayCalendarResult> = {}): UseBusinessDayCalendarResult => {
    const calendar = overrides.calendar ?? BRANCH_CALENDAR;
    return { calendar, ready: true, error: null, retry: jest.fn(), version: calendar.version, ...overrides };
  };
  const endDateInput = () => input("period-card_end-date-input");
  const setDuration = (value: string) => act(() => useFormStore.getState().setVoucherDuration(value));
  const startDateInput = () => input("period-card_start-date-input");
  const keepClient = (overrides: Partial<Client> = {}) =>
    makeClient({ duration: 15, startDate: KEEP_START, endDate: KEEP_END, ...overrides });

  beforeEach(() => {
    mockedCalendarHook.mockReturnValue(calendarResult());
  });

  afterEach(() => {
    mockedCalendarHook.mockReturnValue(calendarResult({ calendar: KR_BUILTIN_CALENDAR }));
  });

  it("guards the fixture: the branch calendar would calculate a different end date than the stored one", () => {
    expect(BRANCH_CALENDAR.calcEndDateBusinessDays(KEEP_START, 15)).toBe("2026-09-30");
  });

  it("shows the stored end date, submits it, and raises no end-date diff", async () => {
    mockClients = [keepClient()];
    await renderOnStep(3);

    expect(endDateInput()).toHaveValue(KEEP_END);
    submit();

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockDispatchHeadless.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ endDate: KEEP_END }));
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("recalculates on the branch calendar once the duration is edited, and shows the end-date diff", async () => {
    mockClients = [keepClient()];
    await renderOnStep(3);
    expect(endDateInput()).toHaveValue(KEEP_END);

    setDuration("16");

    const recalculated = BRANCH_CALENDAR.calcEndDateBusinessDays(KEEP_START, 16);
    expect(recalculated).not.toBe(KEEP_END);
    await waitFor(() => expect(endDateInput()).toHaveValue(recalculated));
    submit();
    const dialog = await screen.findByRole("dialog", { name: DIFF_TITLE });
    expect(within(dialog).getByText("종료일")).toBeInTheDocument();
  });

  it("recalculates when the start date is edited, and does not restore the stored end date on returning to it", async () => {
    mockClients = [keepClient()];
    await renderOnStep(3);

    fireEvent.change(startDateInput(), { target: { value: "2026-09-08" } });
    await waitFor(() => expect(endDateInput()).toHaveValue(BRANCH_CALENDAR.calcEndDateBusinessDays("2026-09-08", 15)));

    fireEvent.change(startDateInput(), { target: { value: KEEP_START } });
    await waitFor(() => expect(endDateInput()).toHaveValue("2026-09-30"));
  });

  it("keeps the stored end date when the client is picked while the calendar loads and it becomes ready", async () => {
    mockedCalendarHook.mockReturnValue(calendarResult({ ready: false, calendar: KR_BUILTIN_CALENDAR }));
    mockClients = [keepClient()];
    const { default: ContractCreationPage } = await import("./page");
    const view = render(<ContractCreationPage />);
    selectStoredClient();
    next(); next(); next();
    expect(endDateInput()).toHaveValue(KEEP_END);

    mockedCalendarHook.mockReturnValue(calendarResult());
    view.rerender(<ContractCreationPage />);

    expect(endDateInput()).toHaveValue(KEEP_END);
  });

  it("keeps a stored end date in a year the calendar does not cover, with no notice and submit allowed", async () => {
    mockClients = [keepClient({ duration: 40, startDate: "2027-12-01", endDate: "2028-01-26" })];
    await renderOnStep(3);

    expect(endDateInput()).toHaveValue("2028-01-26");
    expect(screen.queryByText("이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계약서 생성" })).toBeEnabled();
  });

  it("still clears the end date and blocks submit when an edit makes the calculation reach an unsupported year", async () => {
    mockClients = [keepClient({ duration: 40, startDate: "2027-12-01", endDate: "2028-01-26" })];
    await renderOnStep(3);

    setDuration("41");

    await waitFor(() => expect(endDateInput()).toHaveValue(""));
    expect(screen.getByText("이 기간의 공휴일 정보가 아직 없어요. 종료일을 계산할 수 없어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "계약서 생성" })).toBeDisabled();
  });

  it("auto-calculates for a client with no stored end date", async () => {
    mockClients = [keepClient({ endDate: null })];
    await renderOnStep(3);

    await waitFor(() => expect(endDateInput()).toHaveValue("2026-09-30"));
  });

  it("shows the next client's stored end date after switching to another client", async () => {
    mockClients = [keepClient()];
    await renderOnStep(3);
    expect(endDateInput()).toHaveValue(KEEP_END);

    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByRole("button", { name: "이전" }));
    mockClients = [keepClient({ id: 8, duration: 10, startDate: "2026-10-05", endDate: "2026-10-16" })];
    selectStoredClient();
    next(); next(); next();

    expect(endDateInput()).toHaveValue("2026-10-16");
  });
});
