/**
 * A client whose service record is finalized (serviceRecordPeriodLocked) keeps
 * its stored contract period: the business-day auto-calculation must not
 * overwrite the stored end date, and the date inputs are read-only. Other
 * clients still get the auto-calculated end date.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

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
    openDocument: jest.fn(),
  }),
}));

jest.mock("@/services/api", () => ({
  eformsignApi: {
    dispatchHeadless: jest.fn(),
    generateDocument: jest.fn(),
    createDocRecord: jest.fn().mockResolvedValue({}),
    adoptDocument: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUpdateClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteClient: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
  useVoucherPriceInfos: () => ({
    data: [{ duration: "15", fullPrice: 1000000, grant: 800000, actualPrice: 200000 }],
    isLoading: false,
  }),
  useVoucherYears: () => ({ data: [2026], isLoading: false }),
  useAreaTemplates: () => ({
    data: [{ id: "area-template-1", areaId: "인천", templateId: "template-1", templateName: "인천 산모 계약서" }],
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
const VOUCHER_INFO_STEP_INDEX = 2;
const LOCKED_NOTE = "서비스 기록이 확정된 고객이라 계약 기간을 변경할 수 없어요.";

const BASE_CLIENT: Client = {
  id: 501,
  name: "김민지",
  birthday: null,
  dueDate: null,
  birthDate: null,
  address: "인천시 남동구",
  phone: "010-1111-2222",
  primaryEmployee: null,
  secondaryEmployee: null,
  type: "일반",
  duration: 15,
  fullPrice: "1000000",
  grant: "800000",
  actualPrice: "200000",
  // 2026-09-07 + 15 business days is 2026-09-29 by the calendar the form uses,
  // while the stored (finalized) end date is 2026-09-30.
  startDate: "2026-09-07",
  endDate: "2026-09-30",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: null,
  eDocId: null,
  areaId: "인천",
  hasSigned: false,
  documentStatus: null,
};

function renderForm(client: Client, activeStep: number) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractCreationForm initialClient={client} activeStep={activeStep} onActiveStepChange={jest.fn()} />
    </QueryClientProvider>,
  );
}

describe("ContractCreationForm — finalized service record period lock", () => {
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
    useFormStore.getState().resetAll();
  });

  it("keeps the stored end date and disables the period inputs for a locked client", () => {
    renderForm({ ...BASE_CLIENT, serviceRecordPeriodLocked: true }, CONTRACT_INFO_STEP_INDEX);

    const state = useFormStore.getState();
    expect(state.startDate).toBe("2026-09-07");
    expect(state.voucherDuration).toBe("15");
    expect(state.endDate).toBe("2026-09-30");

    expect(screen.getByLabelText("계약 시작일")).toBeDisabled();
    expect(screen.getByLabelText("계약 종료일")).toBeDisabled();
    expect(screen.getByLabelText("계약 종료일")).toHaveValue("2026-09-30");
    expect(screen.getByLabelText("본인부담금 결제일")).not.toBeDisabled();
    expect(screen.getByTestId("contract-creation-period-locked-note")).toHaveTextContent(LOCKED_NOTE);
  });

  it("disables the voucher duration select for a locked client", () => {
    renderForm({ ...BASE_CLIENT, serviceRecordPeriodLocked: true }, VOUCHER_INFO_STEP_INDEX);

    expect(screen.getByDisplayValue("15일")).toBeDisabled();
  });

  it("keeps the voucher duration select enabled for a client that is not locked", () => {
    renderForm({ ...BASE_CLIENT, serviceRecordPeriodLocked: false }, VOUCHER_INFO_STEP_INDEX);

    expect(screen.getByDisplayValue("15일")).not.toBeDisabled();
  });

  it("still auto-calculates the end date for a client that is not locked", () => {
    renderForm({ ...BASE_CLIENT, serviceRecordPeriodLocked: false }, CONTRACT_INFO_STEP_INDEX);

    expect(useFormStore.getState().endDate).toBe("2026-09-29");
    expect(screen.getByLabelText("계약 시작일")).not.toBeDisabled();
    expect(screen.getByLabelText("계약 종료일")).not.toBeDisabled();
    expect(screen.queryByTestId("contract-creation-period-locked-note")).not.toBeInTheDocument();
  });

  it("treats a client without the flag as unlocked", () => {
    renderForm(BASE_CLIENT, CONTRACT_INFO_STEP_INDEX);

    expect(useFormStore.getState().endDate).toBe("2026-09-29");
    expect(screen.getByLabelText("계약 종료일")).not.toBeDisabled();
  });
});
