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
const DATE_RANGE_ERROR = "종료일은 시작일과 같거나 이후로 입력해 주세요.";
const END_DATE_INVALID_ERROR = "종료일은 YYYY-MM-DD 형식의 유효한 날짜를 입력해 주세요.";
const PAYMENT_DATE_INVALID_ERROR = "결제일은 YYYY-MM-DD 형식의 유효한 날짜를 입력해 주세요.";

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
  act(() => {
    useFormStore.setState({ endDate });
  });
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

  it("shows the date error, disables final submit, and makes no calls for a reversed range", async () => {
    seedContractDates({ startDate: "2026-09-21", endDate: "2026-09-20" });

    renderForm();
    overrideEndDate("2026-09-20");

    expect(screen.getByLabelText("계약 시작일")).toHaveAttribute("id", "contract-creation-start-date");
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("id", "contract-creation-end-date");
    expect(screen.getByLabelText("본인부담금 결제일")).toHaveAttribute("id", "contract-creation-payment-date");
    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(DATE_RANGE_ERROR);
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => {
      expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
      expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
      expect(mockDispatchHeadless).not.toHaveBeenCalled();
      expect(mockGenerateDocument).not.toHaveBeenCalled();
    });
  });

  it("rejects a malformed end date before any mutation", async () => {
    seedContractDates({ startDate: "2026-09-21", endDate: "2026-02-31" });

    renderForm();
    overrideEndDate("2026-02-31");

    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(END_DATE_INVALID_ERROR);
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("계약 종료일")).toHaveAttribute(
      "aria-describedby",
      "contract-creation-date-range-error",
    );
    expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("rejects an incomplete visible end date instead of submitting the stale canonical value", async () => {
    seedContractDates();

    renderForm();
    fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: "2026-09-2" } });

    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(END_DATE_INVALID_ERROR);
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("rejects an incomplete payment date instead of submitting the stale canonical value", async () => {
    seedContractDates();

    renderForm();
    fireEvent.change(screen.getByLabelText("본인부담금 결제일"), { target: { value: "2026-09-1" } });

    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(PAYMENT_DATE_INVALID_ERROR);
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
    expect(mockUpdateClientMutateAsync).not.toHaveBeenCalled();
    expect(mockDispatchHeadless).not.toHaveBeenCalled();
  });

  it("rejects an invalid start date even when the optional end date is empty", async () => {
    seedContractDates({ startDate: "2026-02-31", endDate: "" });

    renderForm();
    overrideEndDate("");

    expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(
      "계약 시작일은 YYYY-MM-DD 형식의 유효한 날짜를 입력해 주세요.",
    );
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
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

    await waitFor(() => expect(screen.getByTestId("contract-creation-date-range-error")).toHaveTextContent(DATE_RANGE_ERROR));
    expect(screen.getByTestId("contract-creation-submit")).toBeDisabled();
    expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("계약 종료일"), { target: { value: "2026-09-22" } });
    await waitFor(() => expect(screen.getByTestId("contract-creation-submit")).not.toBeDisabled());
    expect(screen.queryByTestId("contract-creation-date-range-error")).not.toBeInTheDocument();
  });
});
