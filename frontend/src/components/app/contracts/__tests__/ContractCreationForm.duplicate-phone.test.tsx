/**
 * Coverage for the contract wizard's duplicate-phone conflict handling: the
 * 409 branch at ContractCreationForm.tsx discriminates the duplicate by the
 * public problem code (with a legacy `clientId` fallback) and offers the
 * reuse-existing-client retry.
 *
 * Rendering-based (behavioral), mirroring
 * ContractCreationForm.initial-client.test.tsx.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();
const mockCreateClientMutateAsync = jest.fn().mockResolvedValue({ id: 999 });
const mockUpdateClientMutateAsync = jest.fn().mockResolvedValue({});
const mockDeleteClientMutateAsync = jest.fn().mockResolvedValue({});

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
  useAreaTemplates: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/lib/sse/reconnecting-event-source", () => ({
  createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

/** Axios-like 409 rejection the BFF produces for a duplicate-phone conflict. */
function conflictError(data: Record<string, unknown>) {
  return Object.assign(new Error("Request failed with status code 409"), {
    isAxiosError: true,
    response: { status: 409, data },
  });
}

const CONFIRMATION_TEXT = "이미 같은 전화번호의 고객이 있습니다. 기존 고객으로 계약을 진행할까요?";

function seedAutoRegistrationDraft() {
  // No selected client: submitting runs the auto-registration create path.
  useFormStore.setState({
    clientId: null,
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
    startDate: "2026-08-05",
    endDate: "2026-08-25",
    paymentDate: "2026-08-05",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
    voucherType: "일반",
    voucherDuration: "15",
    area: "인천",
  });
}

const CONTRACT_INFO_STEP_INDEX = 3;

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm activeStep={CONTRACT_INFO_STEP_INDEX} onActiveStepChange={jest.fn()} />
    </QueryClientProvider>
  );
  return render(ui);
}

describe("ContractCreationForm — duplicate-phone conflict", () => {
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
    // clearAllMocks leaves mock*Once queues intact; a stale queued rejection
    // would leak into the next test's first create call.
    mockCreateClientMutateAsync.mockReset();
    mockCreateClientMutateAsync.mockResolvedValue({ id: 999 });
    mockAuthenticate.mockResolvedValue({ success: true });
    mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
    useFormStore.getState().resetAll();
  });

  it("offers the reuse retry when the 409 carries the public duplicate-phone code", async () => {
    seedAutoRegistrationDraft();
    mockCreateClientMutateAsync
      .mockRejectedValueOnce(conflictError({
        code: "CLIENT_PHONE_ALREADY_REGISTERED",
        message: "같은 전화번호의 고객이 이미 등록되어 있어요.",
      }))
      .mockResolvedValueOnce({ id: 73 });
    mockDispatchHeadless.mockResolvedValue({ ok: true });

    renderForm();
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(screen.getByText(CONFIRMATION_TEXT)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockCreateClientMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ reuseExistingClient: true }),
    );
    expect(mockDeleteClientMutateAsync).not.toHaveBeenCalled();
  });

  it("still offers the reuse retry for the legacy clientId conflict payload", async () => {
    seedAutoRegistrationDraft();
    mockCreateClientMutateAsync
      .mockRejectedValueOnce(conflictError({
        message: "이미 같은 전화번호의 고객이 있습니다.",
        clientId: 73,
      }))
      .mockResolvedValueOnce({ id: 73 });
    mockDispatchHeadless.mockResolvedValue({ ok: true });

    renderForm();
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(screen.getByText(CONFIRMATION_TEXT)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(2));
    expect(mockCreateClientMutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ reuseExistingClient: true }),
    );
  });

  it("fails the submission without a reuse offer for any other 409", async () => {
    seedAutoRegistrationDraft();
    mockCreateClientMutateAsync.mockRejectedValueOnce(conflictError({
      message: "자동 고객 등록이 꺼져 있습니다. 고객을 먼저 등록한 뒤 계약서를 생성해 주세요.",
    }));

    renderForm();
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() =>
      expect(screen.getByText(/고객 자동 등록에 실패했어요|자동 고객 등록이 꺼져/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(CONFIRMATION_TEXT)).not.toBeInTheDocument();
    expect(mockCreateClientMutateAsync).toHaveBeenCalledTimes(1);
  });
});
