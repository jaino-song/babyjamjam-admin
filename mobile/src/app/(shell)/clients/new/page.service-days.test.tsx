import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useClientWizardStore } from "@/stores/client-wizard-store";

import type { Client } from "@/lib/client/types";

import NewClientPage from "./page";

// Per-client weekend / holiday service days on the wizard page: the three switches, what is sent,
// and the auto end date that follows them. The branch calendar hook is the built-in list here.

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockPush = jest.fn();
const mockEmptyPrices: never[] = [];
const mockOutOfPocketPrices = [{ id: 1, duration: 10, fullPrice: "900000" }];
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

const endDate = () => useClientWizardStore.getState().endDate;
const chip = (name: string) => screen.getByRole("button", { name });
const goToStep = (step: number) => act(() => useClientWizardStore.getState().setCurrentStep(step));

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
    startDate: "2026-12-14",
    endDate: "2026-12-28",
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

describe("mobile client wizard service days", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue({ id: 7 });
    mockSearchParams = new URLSearchParams();
    mockEditingClient = undefined;
    act(() => useClientWizardStore.getState().reset());
  });

  describe("creating", () => {
    const fillForm = () => act(() => {
      useClientWizardStore.setState({
        name: "서비스일 고객",
        birthday: "1990-01-01",
        dueDate: "2026-12-01",
        address: "인천시",
        phone: "",
        duration: 10,
        fullPrice: "900000",
        grant: "0",
        actualPrice: "900000",
        startDate: "2026-12-14",
        endDate: "",
        currentStep: 1,
      });
    });

    it("moves the auto end date by the Saturday switch and back when it is turned off", async () => {
      render(<NewClientPage />);
      fillForm();

      // 2026-12-14 (Mon): ten weekdays, with the 12-25 holiday skipped.
      await waitFor(() => expect(endDate()).toBe("2026-12-28"));

      fireEvent.click(chip("토요일 서비스"));
      await waitFor(() => expect(endDate()).toBe("2026-12-24"));

      fireEvent.click(chip("토요일 서비스"));
      await waitFor(() => expect(endDate()).toBe("2026-12-28"));
    });

    it("counts a public holiday as a service day when the holiday switch is on", async () => {
      render(<NewClientPage />);
      fillForm();
      await waitFor(() => expect(endDate()).toBe("2026-12-28"));

      fireEvent.click(chip("공휴일 서비스"));

      // 12-25 (Fri) now counts: 14-18, 21-25 is ten days.
      await waitFor(() => expect(endDate()).toBe("2026-12-25"));
    });

    it("keeps a manually typed end date when no switch is touched", async () => {
      render(<NewClientPage />);
      fillForm();
      await waitFor(() => expect(endDate()).toBe("2026-12-28"));
      act(() => useClientWizardStore.setState({ endDate: "2026-12-30" }));

      expect(endDate()).toBe("2026-12-30");
    });

    it("sends all three flags on create", async () => {
      render(<NewClientPage />);
      fillForm();
      await waitFor(() => expect(endDate()).toBe("2026-12-28"));
      fireEvent.click(chip("일요일 서비스"));
      await waitFor(() => expect(endDate()).toBe("2026-12-24"));
      goToStep(2);

      fireEvent.click(screen.getByRole("button", { name: "등록" }));

      await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
      expect(mockCreateClient.mock.calls[0][0]).toEqual(expect.objectContaining({
        allowSaturdayService: false,
        allowSundayService: true,
        allowHolidayService: false,
        endDate: "2026-12-24",
      }));
    });
  });

  describe("editing", () => {
    it("shows the saved values on the switches", async () => {
      await openEdit(makeClient({ allowSaturdayService: true, allowHolidayService: true }));
      goToStep(1);

      expect(useClientWizardStore.getState()).toEqual(expect.objectContaining({
        allowSaturdayService: true,
        allowSundayService: false,
        allowHolidayService: true,
      }));
      expect(chip("토요일 서비스").className).toMatch(/selected/);
      expect(chip("일요일 서비스").className).not.toMatch(/selected/);
      expect(chip("공휴일 서비스").className).toMatch(/selected/);
    });

    it("does not recalculate a saved end date until a switch is touched", async () => {
      await openEdit(makeClient({ allowSaturdayService: true, endDate: "2026-12-31" }));

      expect(endDate()).toBe("2026-12-31");
    });

    it("sends an empty update when nothing changed", async () => {
      await openEdit(makeClient({ allowSundayService: true }));
      goToStep(2);

      fireEvent.click(screen.getByRole("button", { name: "저장" }));

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: {} });
    });

    it("sends only the changed flag, with the recalculated period and the opening end date", async () => {
      await openEdit(makeClient());
      goToStep(1);

      fireEvent.click(chip("토요일 서비스"));
      await waitFor(() => expect(endDate()).toBe("2026-12-24"));
      goToStep(2);
      fireEvent.click(screen.getByRole("button", { name: "저장" }));

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(mockUpdateClient).toHaveBeenCalledWith({
        id: 7,
        dto: {
          allowSaturdayService: true,
          startDate: "2026-12-14",
          endDate: "2026-12-24",
          duration: 10,
          expectedEndDate: "2026-12-28",
        },
      });
    });

    it("recalculates the end date of a saved duration that the price list no longer offers", async () => {
      // The price table offers only 10; the saved period is 12 service days.
      await openEdit(makeClient({ duration: 12, endDate: "2026-12-30" }));
      goToStep(1);

      fireEvent.click(chip("토요일 서비스"));
      await waitFor(() => expect(endDate()).toBe("2026-12-28"));
      goToStep(2);
      fireEvent.click(screen.getByRole("button", { name: "저장" }));

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(mockUpdateClient).toHaveBeenCalledWith({
        id: 7,
        dto: {
          allowSaturdayService: true,
          startDate: "2026-12-14",
          endDate: "2026-12-28",
          duration: 12,
          expectedEndDate: "2026-12-30",
        },
      });
    });
  });
});
