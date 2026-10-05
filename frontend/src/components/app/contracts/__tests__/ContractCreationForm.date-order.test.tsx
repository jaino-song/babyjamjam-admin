import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

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

const CONTRACT_INFO_STEP_INDEX = 3;
const DATE_RANGE_ERROR = "종료일은 시작일 이후여야 해요";
const DATE_NOT_REAL_ERROR = "존재하지 않는 날짜예요";
const DATE_FORMAT_HINT = "YYYY-MM-DD 형식";
const DATE_FORMAT_ERROR = "YYYY-MM-DD로 입력해 주세요";

function seedContractDates(overrides: { startDate?: string; endDate?: string } = {}): void {
  useFormStore.setState({
    clientId: 42,
    name: "송진호",
    phone: "010-6621-1878",
    birthday: "960414",
    dueDate: "",
    birthDate: "",
    address: "인천시",
    employeeId: 7,
    employeeName: "김정인",
    employeePhone: "01057871878",
    showEmployee2: false,
    employee2Id: null,
    startDate: overrides.startDate ?? "2026-09-21",
    endDate: overrides.endDate ?? "2026-09-22",
    paymentDate: "2026-09-18",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    voucherType: "일반",
    voucherDuration: "15",
    area: "인천",
  });
}

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm
        activeStep={CONTRACT_INFO_STEP_INDEX}
        onActiveStepChange={jest.fn()}
      />
    </QueryClientProvider>,
  );
}

function renderRetryableForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Harness() {
    const [activeStep, setActiveStep] = useState(CONTRACT_INFO_STEP_INDEX);
    return (
      <ContractCreationForm
        activeStep={activeStep}
        onActiveStepChange={setActiveStep}
      />
    );
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

function overrideEndDate(endDate: string): void {
  fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: endDate } });
}

describe("ContractCreationForm — contract date ordering", () => {
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
    mockCreateClientMutateAsync.mockReset();
    mockCreateClientMutateAsync.mockResolvedValue({ id: 42 });
    mockUpdateClientMutateAsync.mockReset();
    mockUpdateClientMutateAsync.mockResolvedValue({});
    mockDeleteClientMutateAsync.mockReset();
    mockDeleteClientMutateAsync.mockResolvedValue({});
    mockDispatchHeadless.mockReset();
    mockGenerateDocument.mockReset();
    mockOpenDocument.mockReset();
    useFormStore.getState().resetAll();
  });

  it("shows the range message in the end-date slot and blocks submit for a reversed range", async () => {
    seedContractDates({ startDate: "2026-09-21", endDate: "2026-09-20" });

    renderForm();
    overrideEndDate("2026-09-20");

    expect(screen.getByLabelText("계약 시작일")).toHaveAttribute("id", "contract-creation-start-date");
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("id", "contract-creation-end-date");
    expect(screen.getByLabelText("본인부담금 결제일")).toHaveAttribute("id", "contract-creation-payment-date");
    const error = screen.getByText(DATE_RANGE_ERROR);
    expect(error).toHaveAttribute("data-slot", "field-error-message");
    // It is in the end-date label row (top right), next to the label.
    expect(error.closest("div.justify-between")).toContainElement(screen.getByText("계약 종료일"));
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("aria-describedby", error.id);
    expect(screen.getByLabelText("계약 시작일")).not.toHaveAttribute("aria-invalid");
    // Field problems no longer disable the button; pressing it reports them instead.
    expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(screen.getByLabelText("계약 종료일")).toHaveFocus());
    expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
    expect(mockGenerateDocument).not.toHaveBeenCalled();
    // Not a form-level failure, so the top alert stays empty.
    expect(screen.queryByText(DATE_RANGE_ERROR, { selector: '[role="alert"] *' })).not.toBeInTheDocument();
  });

  it("rejects a non-existent end date before any mutation", async () => {
    seedContractDates({ startDate: "2026-09-21", endDate: "2026-02-31" });

    renderForm();
    overrideEndDate("2026-02-31");

    const error = screen.getByText(DATE_NOT_REAL_ERROR);
    expect(error.closest("div.justify-between")).toContainElement(screen.getByText("계약 종료일"));
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("aria-describedby", error.id);

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(screen.getByLabelText("계약 종료일")).toHaveFocus());
    expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("hints while an end date is incomplete, then turns into an error once the field is left", async () => {
    seedContractDates();

    renderForm();
    const endDateInput = screen.getByLabelText("계약 종료일");
    fireEvent.focus(endDateInput);
    fireEvent.change(endDateInput, { target: { value: "2026-09-2" } });

    const hint = screen.getByText(DATE_FORMAT_HINT);
    expect(hint).toHaveAttribute("data-slot", "field-message");
    expect(endDateInput).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(DATE_FORMAT_ERROR)).not.toBeInTheDocument();

    fireEvent.blur(endDateInput);

    const error = screen.getByText(DATE_FORMAT_ERROR);
    expect(error).toHaveAttribute("data-slot", "field-error-message");
    expect(endDateInput).toHaveAttribute("aria-invalid", "true");
    expect(endDateInput).toHaveAttribute("aria-describedby", error.id);

    // The stale canonical value in the store must not be submitted instead.
    fireEvent.click(screen.getByTestId("contract-creation-submit"));
    await waitFor(() => expect(endDateInput).toHaveFocus());
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("shows the format error for an incomplete payment date after submit is pressed", async () => {
    seedContractDates();

    renderForm();
    const paymentDateInput = screen.getByLabelText("본인부담금 결제일");
    fireEvent.change(paymentDateInput, { target: { value: "2026-09-1" } });
    expect(screen.getByText(DATE_FORMAT_HINT)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(paymentDateInput).toHaveFocus());
    fireEvent.blur(paymentDateInput);
    const error = screen.getByText(DATE_FORMAT_ERROR);
    expect(paymentDateInput).toHaveAttribute("aria-invalid", "true");
    expect(paymentDateInput).toHaveAttribute("aria-describedby", error.id);
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("rejects a non-existent payment date and associates it with the inline error", async () => {
    seedContractDates();

    renderForm();
    fireEvent.change(screen.getByLabelText("본인부담금 결제일"), { target: { value: "2026-02-31" } });

    const paymentDateInput = screen.getByLabelText("본인부담금 결제일");
    const error = screen.getByText(DATE_NOT_REAL_ERROR);
    expect(paymentDateInput).toHaveAttribute("aria-invalid", "true");
    expect(paymentDateInput).toHaveAttribute("aria-describedby", error.id);

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(paymentDateInput).toHaveFocus());
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("rejects a non-existent start date even when the optional end date is empty", async () => {
    seedContractDates({ startDate: "2026-02-31", endDate: "" });

    renderForm();
    overrideEndDate("");

    const error = screen.getByText(DATE_NOT_REAL_ERROR);
    expect(error.closest("div.justify-between")).toContainElement(screen.getByText("계약 시작일"));

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(screen.getByLabelText("계약 시작일")).toHaveFocus());
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("asks for required dates only after submit is pressed, and focuses the first empty one", async () => {
    seedContractDates({ startDate: "", endDate: "" });
    useFormStore.setState({ paymentDate: "" });

    renderForm();
    overrideEndDate("");

    // Nothing is said on first load.
    expect(screen.queryByText(/입력해 주세요/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(screen.getByLabelText("계약 시작일")).toHaveFocus());
    expect(screen.getByText("계약 시작일을 입력해 주세요")).toHaveAttribute("data-slot", "field-error-message");
    expect(screen.getByText("본인부담금 결제일을 입력해 주세요")).toHaveAttribute("data-slot", "field-error-message");
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it.each([
    ["same-day", "2026-09-21", "2026-09-21"],
    ["later", "2026-09-21", "2026-09-22"],
  ])("allows a %s end date", async (_label, startDate, endDate) => {
    seedContractDates({ startDate, endDate });
    mockDispatchHeadless.mockResolvedValue({ ok: true });

    renderForm();
    overrideEndDate(endDate);

    expect(screen.queryByText(DATE_RANGE_ERROR)).not.toBeInTheDocument();
    expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        dto: expect.objectContaining({ startDate, endDate }),
      }),
    );
  });

  it("allows the existing optional end date", async () => {
    seedContractDates({ startDate: "2026-09-21", endDate: "" });
    mockDispatchHeadless.mockResolvedValue({ ok: true });

    renderForm();
    overrideEndDate("");

    expect(screen.queryByText(DATE_RANGE_ERROR)).not.toBeInTheDocument();
    expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1));
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ dto: expect.objectContaining({ endDate: null }) }),
    );
  });

  it("revalidates dates before a retry and returns to step 4 without a second mutation", async () => {
    seedContractDates();
    mockDispatchHeadless.mockResolvedValueOnce({
      ok: false,
      reason: "manual check required",
      fallbackHint: "manual_check",
    });

    renderRetryableForm();
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(screen.getByTestId("contract-creation-retry")).toBeInTheDocument());
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);

    act(() => {
      useFormStore.setState({ endDate: "2026-09-20" });
    });
    fireEvent.click(screen.getByTestId("contract-creation-retry"));

    await waitFor(() => expect(screen.getByText(DATE_RANGE_ERROR)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("계약 종료일")).toHaveFocus());
    expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled();
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: "2026-09-22" } });
    expect(screen.queryByText(DATE_RANGE_ERROR)).not.toBeInTheDocument();
  });
});
