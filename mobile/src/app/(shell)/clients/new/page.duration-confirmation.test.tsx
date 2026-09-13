import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import type { Client } from "@/lib/client/types";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { useClientDialogStore } from "@/stores/client-dialog-store";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockEditingClient: Client | undefined;
let mockEditingContractDocument: object | undefined;
let mockLatePrefill: Record<string, unknown> = {};
let mockEmployees: Array<{ id: number; name: string; phone: string }> = [];
const mockOutOfPocketPrices = [{ id: 1, duration: 15, fullPrice: "1" }];
const mockEmptyPrices: never[] = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mockEditingContractDocument }),
}));

jest.mock("@/hooks/useClients", () => ({
  useClient: () => ({ data: mockEditingClient }),
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: mockEmployees, isLoading: false, refetch: jest.fn() }),
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

jest.mock("@/lib/i18n/translations", () => ({
  t: (_locale: string, key: string) => key,
}));

jest.mock("@/hooks/use-toast", () => ({
  toast: jest.fn(),
}));

jest.mock("@/lib/errors/api-error-mapper", () => ({
  getErrorMessage: () => "save failed",
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
  buildClientEditPrefillFromEformsignDocument: () => mockLatePrefill,
}));

const initialForm = {
  name: "기간 확인 고객",
  birthday: "900101",
  dueDate: "2026-08-01",
  birthDate: "",
  address: "인천시",
  phone: "",
  primaryEmployeeId: null,
  secondaryEmployeeId: null,
  type: "",
  duration: 15,
  fullPrice: "1",
  grant: "0",
  actualPrice: "1",
  startDate: "2026-09-03",
  endDate: "2026-09-08",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking" as const,
  areaId: "",
  currentStep: 2,
  pricesManuallyEdited: false,
  voucherYear: null,
};

function seedForm() {
  act(() => {
    useClientWizardStore.setState(initialForm);
  });
}

function renderCreate() {
  mockSearchParams = new URLSearchParams();
  mockEditingClient = undefined;
  render(<NewClientPage />);
  seedForm();
}

function editingClient(): Client {
  return {
    id: 7,
    name: initialForm.name,
    birthday: initialForm.birthday,
    dueDate: initialForm.dueDate,
    birthDate: null,
    address: initialForm.address,
    phone: null,
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
    eDocId: null,
    areaId: null,
    hasSigned: false,
    documentStatus: null,
  };
}

describe("mobile client service date confirmation", () => {
  beforeEach(() => {
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue({ id: 7 });
    mockPush.mockReset();
    mockSearchParams = new URLSearchParams();
    mockEditingClient = undefined;
    mockEditingContractDocument = undefined;
    mockLatePrefill = {};
    mockEmployees = [];
    act(() => useClientDialogStore.getState().reset());
    useClientWizardStore.getState().reset();
  });

  it("keeps the entered period on cancel and sends the mismatch flag only after confirmation", async () => {
    renderCreate();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });

    expect(mockCreateClient).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-09-03")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2026-09-08")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "서비스 기간 확인" })).getByRole("button", { name: "확인" }));

    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      duration: 15,
      startDate: "2026-09-03",
      endDate: "2026-09-08",
      allowBusinessDayMismatch: true,
    }));
  });

  it("saves a matching create period without carrying confirmation", async () => {
    renderCreate();
    act(() => {
      useClientWizardStore.getState().setField("endDate", "2026-09-23");
    });

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient.mock.calls[0][0]).not.toHaveProperty("allowBusinessDayMismatch");
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
  });

  it("invalidates a pending confirmation when the period changes", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    await screen.findByRole("dialog", { name: "서비스 기간 확인" });

    act(() => {
      useClientWizardStore.getState().setField("endDate", "2026-09-09");
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument());
    expect(mockCreateClient).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "서비스 기간 확인" })).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      endDate: "2026-09-09",
      allowBusinessDayMismatch: true,
    })));
  });

  it("keeps a manually cleared or changed end date until the start date changes", async () => {
    renderCreate();

    const endDateInput = screen.getByDisplayValue("2026-09-08");
    fireEvent.change(endDateInput, { target: { value: "" } });
    expect(endDateInput).toHaveValue("");

    fireEvent.change(endDateInput, { target: { value: "2026-09-09" } });
    expect(endDateInput).toHaveValue("2026-09-09");

    fireEvent.change(screen.getByDisplayValue("2026-09-03"), { target: { value: "2026-09-04" } });
    await waitFor(() => expect(endDateInput).toHaveValue(calcEndDateBusinessDays("2026-09-04", 15)));
  });

  it("keeps a manual end-date clear after late contract-document hydration", async () => {
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = { ...editingClient(), eDocId: "late-contract-document" };
    const view = render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe("2026-09-08"));
    act(() => useClientWizardStore.getState().setCurrentStep(2));
    mockEditingContractDocument = {};
    view.rerender(<NewClientPage />);

    const endDateInput = screen.getByDisplayValue("2026-09-08");
    fireEvent.change(endDateInput, { target: { value: "" } });
    expect(endDateInput).toHaveValue("");
  });

  it("keeps a manual end-date clear when the pending contract document resolves afterward", async () => {
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = { ...editingClient(), eDocId: "pending-contract-document" };
    const view = render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe("2026-09-08"));
    act(() => useClientWizardStore.getState().setCurrentStep(2));
    const endDateInput = screen.getByDisplayValue("2026-09-08");
    fireEvent.change(endDateInput, { target: { value: "" } });
    expect(endDateInput).toHaveValue("");

    mockLatePrefill = { endDate: "2026-09-10" };
    mockEditingContractDocument = {};
    view.rerender(<NewClientPage />);

    await waitFor(() => expect(endDateInput).toHaveValue(""));
  });

  it("keeps cached client dates when the client and contract queries are ready on first render", async () => {
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = {
      ...editingClient(),
      eDocId: "cached-contract-document",
      dueDate: "",
      startDate: "2026-09-01",
      endDate: "2026-09-22",
    };
    mockEditingContractDocument = { id: "cached-contract-document" };
    mockLatePrefill = {
      dueDate: "2026-08-11",
      startDate: "2026-09-03",
      endDate: "2026-09-08",
    };

    render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().startDate).toBe("2026-09-01"));
    expect(useClientWizardStore.getState().endDate).toBe("2026-09-22");
    expect(useClientWizardStore.getState().dueDate).toBe("2026-08-11");
  });

  it("requires edit confirmation and prevents duplicate confirmed submissions", async () => {
    let finish!: (value: { id: number }) => void;
    mockUpdateClient.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    mockSearchParams = new URLSearchParams("clientId=7");
    mockEditingClient = editingClient();
    render(<NewClientPage />);

    await waitFor(() => expect(useClientWizardStore.getState().endDate).toBe("2026-09-08"));
    act(() => {
      useClientWizardStore.getState().setCurrentStep(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    const confirm = within(modal).getByRole("button", { name: "확인" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: 7,
      dto: expect.objectContaining({
        duration: 15,
        startDate: "2026-09-03",
        endDate: "2026-09-08",
        allowBusinessDayMismatch: true,
      }),
    });
    await act(async () => {
      finish({ id: 7 });
    });
  });

  it("hydrates employee IDs from a contract prefill and preserves a later user edit", async () => {
    mockEmployees = [
      { id: 17, name: "김관리", phone: "010-1111-2222" },
      { id: 23, name: "이관리", phone: "010-3333-4444" },
    ];
    act(() => {
      useClientDialogStore.getState().setPrefillClient({
        name: "후보 고객",
        primaryEmployeeId: 17,
        secondaryEmployeeId: 23,
      });
    });

    render(<NewClientPage />);

    await waitFor(() => {
      expect(useClientWizardStore.getState().primaryEmployeeId).toBe(17);
      expect(useClientWizardStore.getState().secondaryEmployeeId).toBe(23);
    });

    act(() => {
      useClientWizardStore.getState().setField("primaryEmployeeId", 23);
    });
    expect(useClientWizardStore.getState().primaryEmployeeId).toBe(23);
    expect(useClientWizardStore.getState().secondaryEmployeeId).toBe(23);
  });
});
