import { act, fireEvent, render, screen } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

const mockCreateClient = jest.fn();
const mockEmptyPrices: never[] = [];

jest.mock("@/hooks/useBusinessDayCalendar");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
}));

jest.mock("@/hooks/useClients", () => ({
  useClient: () => ({ data: undefined }),
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false, refetch: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useAllVoucherPrices: () => ({ data: mockEmptyPrices, isLoading: false, isFetching: false }),
  useOutOfPocketPriceInfos: () => ({ data: mockEmptyPrices, isLoading: false, isError: false }),
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

const slotOf = (element: HTMLElement) =>
  document.getElementById(element.getAttribute("aria-describedby")?.split(" ")[0] ?? "") as HTMLElement;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

const renderPage = async (step = 0) => {
  await act(async () => {
    render(<NewClientPage />);
  });
  act(() => useClientWizardStore.getState().setCurrentStep(step));
};

describe("mobile client wizard field messages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => useClientWizardStore.getState().reset());
    (api.get as jest.Mock).mockResolvedValue({ data: { exists: false } });
  });

  it("shows nothing on first render and keeps the next button pressable", async () => {
    await renderPage();

    ["name", "phone", "birthday", "dueDate", "birthDate", "address"].forEach((id) => {
      expect(slotOf(field(id))).toBeEmptyDOMElement();
      expect(field(id)).not.toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
  });

  it("types a birthday as digits with auto-inserted hyphens", async () => {
    await renderPage();

    expect(field("birthday")).toHaveAttribute("placeholder", "1958-03-03");
    fireEvent.change(field("birthday"), { target: { value: "19580303" } });
    expect(field("birthday")).toHaveValue("1958-03-03");
    expect(slotOf(field("birthday"))).toBeEmptyDOMElement();
  });

  it("reports a cleared required field", async () => {
    await renderPage();

    fireEvent.change(field("name"), { target: { value: "김" } });
    expect(slotOf(field("name"))).toBeEmptyDOMElement();
    fireEvent.change(field("name"), { target: { value: "" } });
    expect(slotOf(field("name"))).toHaveTextContent("이름을 입력해 주세요");
    expect(field("name")).toHaveAttribute("aria-invalid", "true");
  });

  it("hints then errors for a partial phone number", async () => {
    await renderPage();

    fireEvent.focus(field("phone"));
    fireEvent.change(field("phone"), { target: { value: "0101234" } });
    expect(slotOf(field("phone"))).toHaveTextContent("010-1234-5678 형식");
    fireEvent.blur(field("phone"));
    expect(slotOf(field("phone"))).toHaveTextContent("010-1234-5678로 입력해 주세요");
    expect(field("phone")).toHaveAttribute("aria-invalid", "true");
  });

  it("reports a landline as a phone-format error on next instead of staying silent", async () => {
    await renderPage();

    fireEvent.change(field("name"), { target: { value: "김" } });
    fireEvent.change(field("birthday"), { target: { value: "19580303" } });
    fireEvent.change(field("phone"), { target: { value: "0311234567" } });
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    // The phone is focused for the user, so the slot shows the format hint until
    // they leave the field; it then turns into the error.
    expect(field("phone")).toHaveFocus();
    expect(slotOf(field("phone"))).toHaveTextContent("010-1234-5678 형식");
    fireEvent.blur(field("phone"));
    expect(slotOf(field("phone"))).toHaveTextContent("010-1234-5678로 입력해 주세요");
    expect(field("phone")).toHaveAttribute("aria-invalid", "true");
    expect(useClientWizardStore.getState().currentStep).toBe(0);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("on next shows every problem, focuses the first one and does not advance", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(slotOf(field("name"))).toHaveTextContent("이름을 입력해 주세요");
    expect(slotOf(field("phone"))).toHaveTextContent("연락처를 입력해 주세요");
    expect(slotOf(field("birthday"))).toHaveTextContent("생년월일을 입력해 주세요");
    expect(field("name")).toHaveFocus();
    expect(useClientWizardStore.getState().currentStep).toBe(0);
  });

  it("shows the duplicate-check status in the phone slot", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { exists: true } });
    await renderPage();

    await act(async () => {
      fireEvent.change(field("phone"), { target: { value: "01012345678" } });
    });

    expect(slotOf(field("phone"))).toHaveTextContent("이미 등록된 연락처예요");
    expect(field("phone")).toHaveAttribute("aria-invalid", "true");
  });

  it("validates the service period dates on the last step and blocks saving", async () => {
    await renderPage(2);

    expect(field("startDate")).toHaveAttribute("placeholder", "2026-12-01");
    expect(field("endDate")).toHaveAttribute("placeholder", "2026-12-19");

    fireEvent.change(field("startDate"), { target: { value: "20261201" } });
    fireEvent.change(field("endDate"), { target: { value: "20261115" } });
    expect(slotOf(field("endDate"))).toHaveTextContent("종료일은 시작일 이후여야 해요");

    fireEvent.click(screen.getByRole("button", { name: "등록" }));
    expect(field("endDate")).toHaveFocus();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
