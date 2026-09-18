import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

interface AreaTemplate {
  id: string;
  areaId: string;
  templateId: string;
  templateName: string | null;
}

interface AreaTemplatesQueryState {
  data: AreaTemplate[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: jest.Mock;
}

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();
const mockRefetchAreaTemplates = jest.fn();
const mockCreateClientMutateAsync = jest.fn();
const mockUpdateClientMutateAsync = jest.fn();
const mockDeleteClientMutateAsync = jest.fn();
const mockAreaTemplatesQuery: AreaTemplatesQueryState = {
  data: [],
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: mockRefetchAreaTemplates,
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { phone: "010-0000-0000" } }),
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
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAreaTemplates: () => mockAreaTemplatesQuery,
}));

jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const areaTemplate: AreaTemplate = {
  id: "area-template-1",
  areaId: "Namdonggu",
  templateId: "template-1",
  templateName: "남동구 산모 계약서",
};

const unavailableTemplateStates: Array<[string, Pick<AreaTemplatesQueryState, "data" | "isError">]> = [
  ["error", { data: [areaTemplate], isError: true }],
  ["empty", { data: [], isError: false }],
];

function seedStepOneDraft(area = "Namdonggu"): void {
  useFormStore.setState({
    name: "테스트 산모",
    phone: "010-0000-0000",
    birthday: "",
    address: "테스트 주소",
    area,
  });
}

function seedValidContractDraft(): void {
  useFormStore.setState({
    clientId: 42,
    name: "테스트 산모",
    phone: "010-0000-0000",
    birthday: "",
    address: "테스트 주소",
    employeeId: 7,
    employeeName: "테스트 제공인력",
    employeePhone: "010-0000-0001",
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
    area: "Namdonggu",
  });
}

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm activeStep={0} onActiveStepChange={jest.fn()} />
    </QueryClientProvider>,
  );
}

function renderProcessingForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Harness() {
    const [activeStep, setActiveStep] = useState(3);
    return (
      <ContractCreationForm
        activeStep={activeStep}
        onActiveStepChange={setActiveStep}
      />
    );
  }

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    ),
    Harness,
    queryClient,
  };
}

describe("ContractCreationForm — contract template query states", () => {
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
    mockCreateClientMutateAsync.mockResolvedValue({ id: 42 });
    mockUpdateClientMutateAsync.mockResolvedValue({});
    mockDeleteClientMutateAsync.mockResolvedValue({});
    useFormStore.getState().resetAll();
    Object.assign(mockAreaTemplatesQuery, {
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: mockRefetchAreaTemplates,
    });
  });

  it("shows an explicit loading state and keeps the template and next controls disabled", () => {
    seedStepOneDraft();
    Object.assign(mockAreaTemplatesQuery, { isLoading: true, isFetching: true });

    renderForm();

    expect(screen.getByText("계약서 유형을 불러오는 중입니다...")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "계약서 선택" })).toBeDisabled();
    expect(screen.getByTestId("contract-creation-next")).toBeDisabled();
  });

  it("explains that no contract types are configured and blocks a stale selection", () => {
    seedStepOneDraft();

    renderForm();

    expect(screen.getByText(/설정된 계약서 유형이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "계약서 선택" })).toBeDisabled();
    expect(screen.getByTestId("contract-creation-next")).toBeDisabled();
  });

  it("shows a retry action for query errors and preserves the draft", () => {
    seedStepOneDraft();
    Object.assign(mockAreaTemplatesQuery, {
      data: [areaTemplate],
      isError: true,
    });
    mockRefetchAreaTemplates.mockResolvedValue({});

    renderForm();

    expect(screen.getByText(/계약서 유형을 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "계약서 선택" })).toBeDisabled();
    expect(screen.getByTestId("contract-creation-next")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(mockRefetchAreaTemplates).toHaveBeenCalledTimes(1);
    expect(useFormStore.getState()).toEqual(expect.objectContaining({
      name: "테스트 산모",
      phone: "010-0000-0000",
      address: "테스트 주소",
      area: "Namdonggu",
    }));
  });

  it("renders configured contract options and allows advancing with a listed selection", () => {
    seedStepOneDraft();
    Object.assign(mockAreaTemplatesQuery, { data: [areaTemplate] });

    renderForm();

    const trigger = screen.getByRole("combobox", { name: "계약서 선택" });
    expect(trigger).not.toBeDisabled();
    expect(screen.getByTestId("contract-creation-next")).not.toBeDisabled();

    fireEvent.click(trigger);

    expect(screen.getByRole("option", { name: "남동구" })).toBeInTheDocument();
  });

  it.each(unavailableTemplateStates)(
    "blocks a processing retry after the template query becomes %s",
    async (_stateName, unavailableState) => {
      seedValidContractDraft();
      Object.assign(mockAreaTemplatesQuery, { data: [areaTemplate] });
      mockDispatchHeadless.mockResolvedValue({ ok: false, reason: "manual_check" });

      const { Harness, queryClient, rerender } = renderProcessingForm();
      fireEvent.click(screen.getByTestId("contract-creation-submit"));

      await waitFor(() => expect(screen.getByTestId("contract-creation-retry")).toBeInTheDocument());
      expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
      expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);

      Object.assign(mockAreaTemplatesQuery, {
        ...unavailableState,
        isLoading: false,
        isFetching: false,
      });
      rerender(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );

      fireEvent.click(screen.getByTestId("contract-creation-retry"));

      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "계약서 선택" })).toBeDisabled();
      });
      expect(screen.getByText(/(계약서 유형을 불러오지 못했습니다|설정된 계약서 유형이 없습니다)/)).toBeInTheDocument();
      expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
      expect(mockUpdateClientMutateAsync).toHaveBeenCalledTimes(1);
      expect(mockCreateClientMutateAsync).not.toHaveBeenCalled();
      expect(mockGenerateDocument).not.toHaveBeenCalled();
      expect(useFormStore.getState()).toEqual(expect.objectContaining({
        name: "테스트 산모",
        phone: "010-0000-0000",
        address: "테스트 주소",
        employeeName: "테스트 제공인력",
        area: "Namdonggu",
      }));
    },
  );
});
