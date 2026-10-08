import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared";

import { useClientWizardStore } from "@/stores/client-wizard-store";

import type { Client } from "@/lib/client/types";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockPush = jest.fn();
const mockEmptyPrices: never[] = [];
let mockOutOfPocketPrices: Array<{ id: number; duration: number; fullPrice: string }> = [];
let mockSearchParams = new URLSearchParams();
let mockEditingClient: Client | undefined;

jest.mock("@/hooks/useBusinessDayCalendar");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
}));

jest.mock("@/hooks/useClients", () => ({
  useClient: () => ({ data: mockEditingClient }),
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAllVoucherPrices: () => ({ data: mockEmptyPrices, isLoading: false, isFetching: false }),
  useOutOfPocketPriceInfos: () => ({ data: mockOutOfPocketPrices, isLoading: false, isError: false }),
  useVoucherPriceInfos: () => ({ data: mockEmptyPrices, isLoading: false, isError: false }),
  useVoucherYears: () => ({ data: mockEmptyPrices }),
}));

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => null,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn().mockResolvedValue({ data: { exists: false } }) },
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn() },
}));

jest.mock("@/lib/eformsign/client-prefill", () => ({
  buildClientEditPrefillFromEformsignDocument: () => ({}),
}));

const END_DATE_CHANGED_MESSAGE =
  "그동안 서비스 종료일이 바뀌어 저장하지 않았어요. 창을 닫고 다시 열어 최신 정보로 수정해 주세요.";

const field = (id: string) => document.getElementById(id) as HTMLInputElement;

// 2026-11-02 (Mon) .. 2026-11-13 (Fri) is 10 business days.
function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: "홍길동",
    birthday: "1990-01-01",
    dueDate: "2026-10-20",
    birthDate: null,
    address: "인천시 남동구",
    phone: "010-1234-5678",
    areaId: null,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: 10,
    fullPrice: "900000",
    grant: "0",
    actualPrice: "900000",
    startDate: "2026-11-02",
    endDate: "2026-11-13",
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "pre_booking",
    eDocId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  } as unknown as Client;
}

async function openEdit(client: Client) {
  mockSearchParams = new URLSearchParams("clientId=7");
  mockEditingClient = client;
  await act(async () => {
    render(<NewClientPage />);
  });
  await waitFor(() => expect(useClientWizardStore.getState().name).toBe(client.name));
}

const goToStep = (step: number) => act(() => useClientWizardStore.getState().setCurrentStep(step));
const save = () => fireEvent.click(screen.getByRole("button", { name: "저장" }));
const calledDto = () => mockUpdateClient.mock.calls[0]?.[0]?.dto;

describe("mobile client wizard edit saves do not write back a stale snapshot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateClient.mockReset().mockResolvedValue({ id: 7 });
    mockOutOfPocketPrices = [];
    mockSearchParams = new URLSearchParams();
    mockEditingClient = undefined;
    act(() => useClientWizardStore.getState().reset());
  });

  it("sends an empty update when nothing changed", async () => {
    await openEdit(makeClient());
    goToStep(2);

    save();

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: {} });
    expect(mockPush).toHaveBeenCalledWith("/clients?id=7");
  });

  it("sends only the address for an address-only edit, with no period fields", async () => {
    await openEdit(makeClient());
    fireEvent.change(field("address"), { target: { value: "인천시 연수구" } });
    goToStep(2);

    save();

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: { address: "인천시 연수구" } });
  });

  it("does not ask about a delayed client's period when only the address is edited", async () => {
    // Delayed: 10 sessions, end date pushed to 2026-11-17 (12 business days).
    await openEdit(makeClient({ endDate: "2026-11-17" }));
    fireEvent.change(field("address"), { target: { value: "인천시 연수구" } });
    goToStep(2);

    save();

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
    expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: { address: "인천시 연수구" } });
  });

  it("sends the whole period and the opening end date when the start date changes", async () => {
    mockOutOfPocketPrices = [{ id: 1, duration: 10, fullPrice: "900000" }];
    await openEdit(makeClient());
    goToStep(2);

    fireEvent.change(field("startDate"), { target: { value: "2026-11-03" } });
    fireEvent.change(field("endDate"), { target: { value: "2026-11-16" } });
    save();

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: 7,
      dto: {
        startDate: "2026-11-03",
        endDate: "2026-11-16",
        duration: 10,
        expectedEndDate: "2026-11-13",
      },
    });
  });

  it("tells staff to reopen the form when the backend reports the end date moved", async () => {
    mockOutOfPocketPrices = [{ id: 1, duration: 10, fullPrice: "900000" }];
    mockUpdateClient.mockRejectedValue({
      response: {
        status: 409,
        data: createProblemDetails({
          code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
          requestId: "req-end-date-moved",
          status: 409,
        }),
      },
    });
    await openEdit(makeClient());
    goToStep(2);

    fireEvent.change(field("startDate"), { target: { value: "2026-11-03" } });
    fireEvent.change(field("endDate"), { target: { value: "2026-11-16" } });
    save();

    expect(await screen.findByText(END_DATE_CHANGED_MESSAGE)).toBeInTheDocument();
    // The edit stays in the form and the user is not navigated away.
    expect(field("startDate")).toHaveValue("2026-11-03");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not claim the end date moved when the rejected save carried no end-date guard", async () => {
    mockUpdateClient.mockRejectedValue({
      response: {
        status: 409,
        data: createProblemDetails({
          code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
          requestId: "req-other-conflict",
          status: 409,
        }),
      },
    });
    await openEdit(makeClient());
    fireEvent.change(field("address"), { target: { value: "인천시 연수구" } });
    goToStep(2);

    save();

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(END_DATE_CHANGED_MESSAGE)).not.toBeInTheDocument();
  });

  describe("employees", () => {
    const withEmployees = () => makeClient({
      primaryEmployee: { id: 3, name: "가" },
      secondaryEmployee: { id: 4, name: "나" },
    } as unknown as Partial<Client>);

    it("removes the secondary employee with an explicit null", async () => {
      await openEdit(withEmployees());
      goToStep(2);
      act(() => useClientWizardStore.getState().setField("secondaryEmployeeId", null));

      save();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: { secondaryEmployeeId: null } });
    });

    it("does not send an employee that was left alone", async () => {
      await openEdit(withEmployees());
      goToStep(2);

      save();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: {} });
    });
  });

  describe("prices", () => {
    // A client with no stored prices: opening the form fills them from the price table.
    const unpricedClient = () => makeClient({ fullPrice: null, grant: null, actualPrice: null });

    beforeEach(() => {
      mockOutOfPocketPrices = [{ id: 1, duration: 10, fullPrice: "1,000,000" }];
    });

    it("does not send the prices the form filled in from the price table on open", async () => {
      await openEdit(unpricedClient());
      await waitFor(() => expect(useClientWizardStore.getState().fullPrice).toBe("1000000"));
      fireEvent.change(field("address"), { target: { value: "인천시 연수구" } });
      goToStep(2);

      save();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(calledDto()).toEqual({ address: "인천시 연수구" });
    });

    it("sends the table's prices when staff change the dates after the form already filled them in", async () => {
      // Stored prices are null, so the filled-in 1000000 differs from what is stored: it is a re-pricing
      // the moment staff touch a date, even though the fill itself happened before the touch.
      await openEdit(unpricedClient());
      await waitFor(() => expect(useClientWizardStore.getState().fullPrice).toBe("1000000"));
      goToStep(2);
      fireEvent.change(field("startDate"), { target: { value: "2026-11-03" } });
      fireEvent.change(field("endDate"), { target: { value: "2026-11-16" } });

      save();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(calledDto()).toEqual(expect.objectContaining({
        startDate: "2026-11-03",
        endDate: "2026-11-16",
        expectedEndDate: "2026-11-13",
        fullPrice: "1000000",
        actualPrice: "1000000",
      }));
    });

    it("sends the prices once staff re-price the client", async () => {
      await openEdit(unpricedClient());
      await waitFor(() => expect(useClientWizardStore.getState().fullPrice).toBe("1000000"));
      goToStep(1);
      fireEvent.change(field("fullPrice"), { target: { value: "1,200,000" } });
      goToStep(2);

      save();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      // A self-pay client's actual price is its full price, so both move together.
      expect(calledDto()).toEqual({ fullPrice: "1200000", actualPrice: "1200000" });
    });

    it("sends a price the table fills in after staff touched a price driver", async () => {
      // The table is not loaded yet when staff change the end date, so the later fill is a re-pricing.
      mockOutOfPocketPrices = [];
      mockSearchParams = new URLSearchParams("clientId=7");
      mockEditingClient = unpricedClient();
      let view!: ReturnType<typeof render>;
      await act(async () => {
        view = render(<NewClientPage />);
      });
      await waitFor(() => expect(useClientWizardStore.getState().name).toBe("홍길동"));
      goToStep(2);
      fireEvent.change(field("endDate"), { target: { value: "2026-11-16" } });

      mockOutOfPocketPrices = [{ id: 1, duration: 10, fullPrice: "1,000,000" }];
      await act(async () => {
        view.rerender(<NewClientPage />);
      });
      await waitFor(() => expect(useClientWizardStore.getState().fullPrice).toBe("1000000"));

      save();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(calledDto()).toEqual(expect.objectContaining({ fullPrice: "1000000", actualPrice: "1000000" }));
    });

    it("sends a stored client's changed price without touching the period", async () => {
      await openEdit(makeClient());
      goToStep(1);
      fireEvent.change(field("fullPrice"), { target: { value: "950,000" } });
      goToStep(2);

      save();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(calledDto()).toEqual({ fullPrice: "950000", actualPrice: "950000" });
    });
  });
});
