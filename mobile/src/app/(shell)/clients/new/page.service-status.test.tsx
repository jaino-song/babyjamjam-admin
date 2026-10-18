import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared/errors/problem-details";

import type { Client } from "@/lib/client/types";
import { api } from "@/lib/api/client";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

// Rule 고객-04: a new client is always 예약 전; a save can no longer move a client between 예약 전 and
// 대기·진행·완료, so the wizard's status select offers only what the server accepts.

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockEditingClient: Client | undefined;
const mockOutOfPocketPrices = [{ id: 1, duration: 15, fullPrice: "1" }];
const mockEmptyPrices: never[] = [];

jest.mock("@/hooks/useBusinessDayCalendar");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(() => ({ data: undefined })),
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
  useOutOfPocketPriceInfos: () => ({
    data: mockOutOfPocketPrices,
    isLoading: false,
    isError: false,
  }),
  useVoucherPriceInfos: () => ({ data: mockEmptyPrices, isLoading: false }),
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
  api: { get: jest.fn() },
}));

jest.mock("@/services/api", () => ({
  eformsignApi: { getDocument: jest.fn() },
}));

jest.mock("@/lib/eformsign/client-prefill", () => ({
  buildClientEditPrefillFromEformsignDocument: () => ({}),
}));

const HELPER = "대기·진행·완료는 고객 상세의 [예약 확정]으로 바뀝니다.";
const REFUSAL = "이 상태로는 저장할 수 없습니다. 예약 상태는 [예약 확정]으로만 바꿀 수 있습니다.";

const initialForm = {
  name: "등록 고객",
  birthday: "1958-03-03",
  dueDate: "2026-08-01",
  birthDate: "",
  address: "인천시",
  phone: "010-1234-5678",
  primaryEmployeeId: null,
  secondaryEmployeeId: null,
  type: "",
  duration: 15,
  fullPrice: "1",
  grant: "0",
  actualPrice: "1",
  startDate: "2026-09-03",
  endDate: "2026-09-23",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking" as const,
  areaId: "",
  currentStep: 2,
  pricesManuallyEdited: false,
  voucherYear: null,
};

function seedForm(overrides: Partial<typeof initialForm> | { serviceStatus: string } = {}) {
  act(() => {
    useClientWizardStore.setState({ ...initialForm, ...overrides } as typeof initialForm);
  });
}

function renderCreate(seed: Parameters<typeof seedForm>[0] = {}) {
  mockSearchParams = new URLSearchParams();
  mockEditingClient = undefined;
  render(<NewClientPage />);
  seedForm(seed);
}

function editClient(overrides: Partial<Client> = {}): Client {
  return {
    id: 7,
    name: initialForm.name,
    birthday: initialForm.birthday,
    dueDate: initialForm.dueDate,
    birthDate: null,
    address: initialForm.address,
    phone: initialForm.phone,
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: initialForm.duration,
    fullPrice: initialForm.fullPrice,
    grant: initialForm.grant,
    actualPrice: initialForm.actualPrice,
    startDate: initialForm.startDate,
    endDate: initialForm.endDate,
    careCenter: false,
    voucherClient: false,
    breastPump: false,
    serviceStatus: "pre_booking",
    bookingConfirmedAt: null,
    eDocId: null,
    areaId: null,
    hasSigned: false,
    documentStatus: null,
    ...overrides,
  };
}

async function renderEdit(overrides: Partial<Client> = {}) {
  mockSearchParams = new URLSearchParams("clientId=7");
  mockEditingClient = editClient(overrides);
  await act(async () => {
    render(<NewClientPage />);
  });
  await waitFor(() => expect(useClientWizardStore.getState().name).toBe(initialForm.name));
  act(() => useClientWizardStore.getState().setCurrentStep(2));
}

const statusSelect = () => screen.getByLabelText("계약 상태") as HTMLSelectElement;
const optionLabels = () => within(statusSelect()).getAllByRole("option").map((option) => option.textContent);
const clickSubmit = () => fireEvent.click(screen.getByRole("button", { name: /^(등록|저장)$/ }));

describe("mobile client wizard 계약 상태 select (rule 고객-04)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockEditingClient = undefined;
    useClientWizardStore.getState().reset();
    (api.get as jest.Mock).mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue({ id: 7 });
  });

  describe("creating", () => {
    it("renders the select disabled with 예약 전 as its only option, plus the helper line", () => {
      renderCreate();

      expect(statusSelect()).toBeDisabled();
      expect(optionLabels()).toEqual(["예약 전"]);
      expect(statusSelect()).toHaveValue("pre_booking");
      expect(screen.getByText(HELPER)).toBeInTheDocument();
    });

    it("sends 예약 전 even when a prefill left another status in the form", async () => {
      renderCreate({ serviceStatus: "active" });

      expect(statusSelect()).toHaveValue("pre_booking");
      clickSubmit();

      await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
      expect(mockCreateClient.mock.calls[0][0]).toEqual(expect.objectContaining({ serviceStatus: "pre_booking" }));
    });
  });

  describe("editing", () => {
    it("offers 예약 전 and 중단 for an unconfirmed client, with the helper line", async () => {
      await renderEdit();

      expect(statusSelect()).toBeEnabled();
      expect(optionLabels()).toEqual(["예약 전", "중단"]);
      expect(statusSelect()).toHaveValue("pre_booking");
      expect(screen.getByText(HELPER)).toBeInTheDocument();
    });

    it("keeps an unconfirmed client's other current status so the value still renders", async () => {
      await renderEdit({ serviceStatus: "replacement_requested" });

      expect(optionLabels()).toEqual(["예약 전", "교체 요청", "중단"]);
      expect(statusSelect()).toHaveValue("replacement_requested");
    });

    it("does not offer 예약 전 to a confirmed client, and drops the helper line", async () => {
      await renderEdit({ bookingConfirmedAt: "2026-10-01T00:00:00.000Z", serviceStatus: "waiting" });

      expect(optionLabels()).not.toContain("예약 전");
      expect(optionLabels()).toEqual(["대기", "교체 요청", "진행중", "완료", "중단"]);
      expect(statusSelect()).toHaveValue("waiting");
      expect(screen.queryByText(HELPER)).not.toBeInTheDocument();
    });

    it("still renders 예약 전 for a confirmed client whose effective status is 예약 전", async () => {
      await renderEdit({ bookingConfirmedAt: "2026-10-01T00:00:00.000Z", serviceStatus: "pre_booking" });

      expect(optionLabels()).toContain("예약 전");
      expect(statusSelect()).toHaveValue("pre_booking");
    });

    it("sends nothing for the status when it was left alone", async () => {
      await renderEdit();

      clickSubmit();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: {} });
    });
  });

  describe("a server refusal at /serviceStatus", () => {
    it("shows the authored sentence on the field and in the summary, not the server's text", async () => {
      mockUpdateClient.mockRejectedValueOnce({
        response: {
          status: 400,
          data: createProblemDetails({
            code: "VALIDATION_FAILED",
            requestId: "request-bjj-438-status",
            outcome: "NOT_APPLIED",
            errors: [
              { pointer: "/serviceStatus", code: "INVALID_VALUE", detail: "RAW SERVER STATUS TEXT", location: "body" },
            ],
          }),
        },
      });
      await renderEdit();
      fireEvent.change(statusSelect(), { target: { value: "terminated" } });

      clickSubmit();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(`계약 상태: ${REFUSAL}`);
      expect(alert).not.toHaveTextContent("RAW SERVER STATUS TEXT");
      // Near the field: its message slot carries the sentence and the select points at it.
      expect(document.getElementById("serviceStatus-message")).toHaveTextContent(REFUSAL);
      expect(statusSelect()).toHaveAttribute("aria-invalid", "true");
      expect(statusSelect().getAttribute("aria-describedby")).toContain("serviceStatus-message");
      expect(statusSelect().getAttribute("aria-describedby")).toContain(
        "mobile_clients-new_screen_root_error-summary_item-0",
      );
    });

    it("shows no refusal text when the save was accepted", async () => {
      await renderEdit();

      clickSubmit();

      await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
    });
  });
});
