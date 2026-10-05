import { act, fireEvent, render, screen } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import type { Client } from "@/lib/client/types";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockEmptyPrices: never[] = [];
let mockVoucherPrices: unknown[] = mockEmptyPrices;
let mockVoucherPricesLoading = false;
let mockVoucherPricesError = false;
let mockSearchParams = new URLSearchParams();
let mockEditingClient: Client | undefined;

jest.mock("@/hooks/useBusinessDayCalendar");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
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
  useOutOfPocketPriceInfos: () => ({ data: mockEmptyPrices, isLoading: false, isError: false }),
  useVoucherPriceInfos: () => ({
    data: mockVoucherPricesError ? undefined : mockVoucherPrices,
    isLoading: mockVoucherPricesLoading,
    isError: mockVoucherPricesError,
  }),
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

const slotOf = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby")?.split(" ")[0] ?? "") as HTMLElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

const LANDLINE = "0324425992";

function makeStoredClient(phone: string): Client {
  return {
    id: 5,
    name: "김유선",
    phone,
    birthday: "1958-03-03",
    dueDate: null,
    birthDate: null,
    address: "인천시 남동구",
    areaId: "Namdonggu",
    primaryEmployee: null,
    secondaryEmployee: null,
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    eDocId: null,
  } as unknown as Client;
}

const renderPage = async () => {
  await act(async () => {
    render(<NewClientPage />);
  });
};

const nextButton = () => screen.getByRole("button", { name: "다음" });

describe("mobile client wizard - editing a client stored with a landline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVoucherPrices = mockEmptyPrices;
    mockVoucherPricesLoading = false;
    mockVoucherPricesError = false;
    mockSearchParams = new URLSearchParams();
    mockEditingClient = undefined;
    act(() => useClientWizardStore.getState().reset());
    (api.get as jest.Mock).mockResolvedValue({ data: { exists: false } });
  });

  it("lets the unchanged stored landline pass step 1 with no error", async () => {
    mockSearchParams = new URLSearchParams("clientId=5");
    mockEditingClient = makeStoredClient(LANDLINE);
    await renderPage();

    expect(field("phone")).toHaveValue(LANDLINE);
    expect(field("phone")).not.toHaveAttribute("aria-invalid", "true");
    expect(slotOf(field("phone"))).not.toHaveTextContent("010-1234-5678");

    fireEvent.click(nextButton());
    expect(useClientWizardStore.getState().currentStep).toBe(1);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("applies the mobile-only rule once the phone is edited, and again accepts the stored number when restored", async () => {
    mockSearchParams = new URLSearchParams("clientId=5");
    mockEditingClient = makeStoredClient(LANDLINE);
    await renderPage();

    fireEvent.change(field("phone"), { target: { value: "0311234567" } });
    fireEvent.blur(field("phone"));
    expect(slotOf(field("phone"))).toHaveTextContent("010-1234-5678로 입력해 주세요");
    expect(field("phone")).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(nextButton());
    expect(useClientWizardStore.getState().currentStep).toBe(0);

    fireEvent.change(field("phone"), { target: { value: "0324425992" } });
    expect(field("phone")).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.click(nextButton());
    expect(useClientWizardStore.getState().currentStep).toBe(1);
  });

  it("does not waive the rule for a different landline typed over a stored mobile number", async () => {
    mockSearchParams = new URLSearchParams("clientId=5");
    mockEditingClient = makeStoredClient("01012345678");
    await renderPage();

    fireEvent.change(field("phone"), { target: { value: LANDLINE } });
    fireEvent.blur(field("phone"));
    expect(slotOf(field("phone"))).toHaveTextContent("010-1234-5678로 입력해 주세요");
    expect(field("phone")).toHaveAttribute("aria-invalid", "true");
  });

  it("still rejects a landline for a new client", async () => {
    await renderPage();

    fireEvent.change(field("name"), { target: { value: "김" } });
    fireEvent.change(field("birthday"), { target: { value: "19580303" } });
    fireEvent.change(field("phone"), { target: { value: LANDLINE } });
    fireEvent.click(nextButton());

    expect(useClientWizardStore.getState().currentStep).toBe(0);
    fireEvent.blur(field("phone"));
    expect(slotOf(field("phone"))).toHaveTextContent("010-1234-5678로 입력해 주세요");
    expect(field("phone")).toHaveAttribute("aria-invalid", "true");
  });
});
