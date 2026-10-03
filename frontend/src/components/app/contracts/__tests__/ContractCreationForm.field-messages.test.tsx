import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockCreateClientMutateAsync = jest.fn();
const mockUpdateClientMutateAsync = jest.fn();
const mockDeleteClientMutateAsync = jest.fn();

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
    dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
    generateDocument: (...args: unknown[]) => mockGenerateDocument(...args),
    createDocRecord: jest.fn().mockResolvedValue({}),
    adoptDocument: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => flag === "headlessDispatch",
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: mockCreateClientMutateAsync, isPending: false }),
  useUpdateClient: () => ({ mutateAsync: mockUpdateClientMutateAsync, isPending: false }),
  useDeleteClient: () => ({ mutateAsync: mockDeleteClientMutateAsync, isPending: false }),
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAreaTemplates: () => ({
    data: [{
      id: "area-template-1",
      areaId: "인천",
      templateId: "template-1",
      templateName: "인천 산모 계약서",
    }],
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  }),
}));

jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CUSTOMER_STEP_INDEX = 0;
const CONTRACT_INFO_STEP_INDEX = 3;
const FIELD_MESSAGE_SELECTOR = '[data-slot="field-message"], [data-slot="field-error-message"]';

function seedCustomerStep(overrides: Partial<ReturnType<typeof useFormStore.getState>> = {}): void {
  useFormStore.setState({
    clientId: 42,
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
    startDate: "2026-09-21",
    endDate: "2026-09-22",
    paymentDate: "2026-09-18",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    voucherType: "일반",
    voucherDuration: "15",
    area: "인천",
    ...overrides,
  });
}

function renderForm(activeStep: number, onActiveStepChange = jest.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (step: number) => (
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm activeStep={step} onActiveStepChange={onActiveStepChange} />
    </QueryClientProvider>
  );
  const view = render(tree(activeStep));
  return { ...view, onActiveStepChange, goToStep: (step: number) => view.rerender(tree(step)) };
}

describe("ContractCreationForm — inline field messages", () => {
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
    mockCreateClientMutateAsync.mockReset().mockResolvedValue({ id: 42 });
    mockUpdateClientMutateAsync.mockReset().mockResolvedValue({});
    mockDeleteClientMutateAsync.mockReset().mockResolvedValue({});
    mockDispatchHeadless.mockReset().mockResolvedValue({ ok: true });
    mockGenerateDocument.mockReset();
    mockOpenDocument.mockReset();
    useFormStore.getState().resetAll();
  });

  it("shows no field messages on first render of the customer step", () => {
    seedCustomerStep();
    const { container } = renderForm(CUSTOMER_STEP_INDEX);

    expect(container.querySelectorAll(FIELD_MESSAGE_SELECTOR)).toHaveLength(0);
  });

  it("shows no field messages for prefilled valid values, with dates displayed as YYYY-MM-DD", () => {
    seedCustomerStep({ birthday: "1958-03-03", dueDate: "2026-11-20T00:00:00.000Z", birthDate: "2026-11-21" });
    const { container } = renderForm(CUSTOMER_STEP_INDEX);

    expect(screen.getByLabelText("생년월일")).toHaveValue("1958-03-03");
    expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("출산일")).toHaveValue("2026-11-21");
    expect(container.querySelectorAll(FIELD_MESSAGE_SELECTOR)).toHaveLength(0);
  });

  it("shows no field messages on first render of an empty contract-dates step", () => {
    seedCustomerStep({ startDate: "", endDate: "", paymentDate: "" });
    const { container } = renderForm(CONTRACT_INFO_STEP_INDEX);

    expect(container.querySelectorAll(FIELD_MESSAGE_SELECTOR)).toHaveLength(0);
  });

  it("uses example dates as placeholders instead of format text", () => {
    seedCustomerStep({ startDate: "", endDate: "", paymentDate: "", clientId: null });
    const { goToStep } = renderForm(CUSTOMER_STEP_INDEX);

    expect(screen.getByLabelText("생년월일")).toHaveAttribute("placeholder", "1958-03-03");
    expect(screen.getByLabelText("출산 예정일")).toHaveAttribute("placeholder", "2026-11-20");
    expect(screen.getByLabelText("출산일")).toHaveAttribute("placeholder", "2026-11-20");

    goToStep(CONTRACT_INFO_STEP_INDEX);

    expect(screen.getByLabelText("계약 시작일")).toHaveAttribute("placeholder", "2026-12-01");
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("placeholder", "2026-12-19");
    expect(screen.getByLabelText("본인부담금 결제일")).toHaveAttribute("placeholder", "2026-11-25");
  });

  it("formats a typed 출산 예정일 as YYYY-MM-DD and submits the same ISO date", async () => {
    seedCustomerStep();
    const { goToStep } = renderForm(CUSTOMER_STEP_INDEX);

    fireEvent.change(screen.getByLabelText("출산 예정일"), { target: { value: "20261120" } });
    expect(screen.getByLabelText("출산 예정일")).toHaveValue("2026-11-20");
    expect(screen.getByLabelText("출산 예정일")).not.toHaveAttribute("aria-invalid");
    expect(useFormStore.getState().dueDate).toBe("2026-11-20");

    goToStep(CONTRACT_INFO_STEP_INDEX);
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1));
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ dto: expect.objectContaining({ dueDate: "2026-11-20" }) }),
    );
  });

  it("hints while a date is focused and incomplete, then reports the format error after it is left", () => {
    seedCustomerStep();
    renderForm(CUSTOMER_STEP_INDEX);
    const dueDateInput = screen.getByLabelText("출산 예정일");

    fireEvent.focus(dueDateInput);
    fireEvent.change(dueDateInput, { target: { value: "202611" } });
    expect(dueDateInput).toHaveValue("2026-11");
    expect(screen.getByText("YYYY-MM-DD 형식")).toHaveAttribute("data-slot", "field-message");
    expect(dueDateInput).not.toHaveAttribute("aria-invalid");

    fireEvent.blur(dueDateInput);
    const error = screen.getByText("YYYY-MM-DD로 입력해 주세요");
    expect(error).toHaveAttribute("data-slot", "field-error-message");
    expect(error).toHaveClass("truncate");
    // The message sits in the label row, above the input.
    expect(error.closest("div.justify-between")).toContainElement(screen.getByText("출산 예정일"));
    expect(dueDateInput).toHaveAttribute("aria-invalid", "true");
    expect(dueDateInput).toHaveAttribute("aria-describedby", error.id);
  });

  it("blocks 다음 on a bad date, reveals the problem and focuses it without advancing", () => {
    seedCustomerStep();
    const { onActiveStepChange } = renderForm(CUSTOMER_STEP_INDEX);

    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "1958" } });
    fireEvent.change(screen.getByLabelText("출산일"), { target: { value: "20261301" } });
    expect(screen.getByLabelText("출산일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("존재하지 않는 날짜예요")).toBeInTheDocument();
    expect(screen.getByTestId("contract-creation-next")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("contract-creation-next"));

    expect(onActiveStepChange).not.toHaveBeenCalled();
    // The birthday is the first problem field on the step.
    expect(screen.getByLabelText("생년월일")).toHaveFocus();
    expect(screen.getByLabelText("출산일")).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(screen.getByLabelText("생년월일"));
    expect(screen.getByLabelText("생년월일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("YYYY-MM-DD로 입력해 주세요")).toBeInTheDocument();
  });

  it("advances once every field on the step is fine", () => {
    seedCustomerStep();
    const { onActiveStepChange } = renderForm(CUSTOMER_STEP_INDEX);

    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19580303" } });
    expect(screen.getByLabelText("생년월일")).toHaveValue("1958-03-03");
    fireEvent.click(screen.getByTestId("contract-creation-next"));

    expect(onActiveStepChange).toHaveBeenCalledWith(1);
  });

  it("rejects a birthday in the future", () => {
    seedCustomerStep();
    renderForm(CUSTOMER_STEP_INDEX);

    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "29990101" } });

    const error = screen.getByText("미래 날짜는 입력할 수 없어요");
    expect(error).toHaveAttribute("data-slot", "field-error-message");
    expect(screen.getByLabelText("생년월일")).toHaveAttribute("aria-invalid", "true");
  });

  it("blocks 다음 on an incomplete customer phone and focuses it", () => {
    seedCustomerStep({ phone: "010-6621-1878" });
    const { onActiveStepChange, container } = renderForm(CUSTOMER_STEP_INDEX);
    const phoneInput = container.querySelector<HTMLInputElement>(
      '[data-component="desktop_messages_form_contact-input"] input',
    );
    if (!phoneInput) throw new Error("phone input not rendered");

    fireEvent.change(phoneInput, { target: { value: "010-66" } });
    fireEvent.click(screen.getByTestId("contract-creation-next"));

    expect(onActiveStepChange).not.toHaveBeenCalled();
    expect(phoneInput).toHaveFocus();
    fireEvent.blur(phoneInput);
    const error = screen.getByText("010-1234-5678로 입력해 주세요");
    expect(error).toHaveAttribute("data-slot", "field-error-message");
    expect(phoneInput).toHaveAttribute("aria-invalid", "true");
  });

  it("asks for the phone after it was cleared", () => {
    seedCustomerStep();
    const { container } = renderForm(CUSTOMER_STEP_INDEX);
    const phoneInput = container.querySelector<HTMLInputElement>(
      '[data-component="desktop_messages_form_contact-input"] input',
    );
    if (!phoneInput) throw new Error("phone input not rendered");

    fireEvent.change(phoneInput, { target: { value: "" } });

    expect(screen.getByText("산모님 연락처를 입력해 주세요")).toHaveAttribute("data-slot", "field-error-message");
  });
});
