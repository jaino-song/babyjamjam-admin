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

const renderPage = async (step = 0) => {
  await act(async () => {
    render(<NewClientPage />);
  });
  act(() => useClientWizardStore.getState().setCurrentStep(step));
};

describe("mobile client wizard field messages", () => {
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

  describe("service period guidance", () => {
    const GUIDANCE = "유형에 따라 기간이 달라져요";

    it("keeps the voucher period guidance in the label-row slot and nothing below the select", async () => {
      await renderPage(1);
      act(() => useClientWizardStore.getState().setField("voucherClient", true));

      const duration = field("duration");
      expect(slotOf(duration)).toHaveTextContent(GUIDANCE);
      expect(slotOf(duration)).toHaveAttribute("aria-live", "polite");
      // The guidance exists exactly once: in the slot, not as a line under the select.
      expect(screen.getAllByText(GUIDANCE)).toHaveLength(1);
      const wrapper = duration.closest('[data-component$="duration-field"]') as HTMLElement;
      expect(wrapper.querySelectorAll("p")).toHaveLength(0);
    });

    it("shows no guidance for a self-pay client", async () => {
      await renderPage(1);

      expect(slotOf(field("duration"))).toBeEmptyDOMElement();
      expect(screen.queryByText(GUIDANCE)).not.toBeInTheDocument();
    });

    it("keeps the guidance when 다음 is pressed with no type or period, and shows no required error", async () => {
      await renderPage(1);
      act(() => useClientWizardStore.getState().setField("voucherClient", true));

      fireEvent.click(screen.getByRole("button", { name: "다음" }));

      expect(useClientWizardStore.getState().currentStep).toBe(2);
      expect(screen.queryByText("바우처 유형을 선택해 주세요")).not.toBeInTheDocument();
      expect(screen.queryByText("서비스 기간을 선택해 주세요")).not.toBeInTheDocument();

      act(() => useClientWizardStore.getState().setCurrentStep(1));
      expect(slotOf(field("type"))).toBeEmptyDOMElement();
      expect(field("type")).not.toHaveAttribute("aria-invalid", "true");
      expect(slotOf(field("duration"))).toHaveTextContent(GUIDANCE);
      expect(field("duration")).not.toHaveAttribute("aria-invalid", "true");
    });
  });

  describe("service step gate", () => {
    const PRICES = [{ duration: 15, fullPrice: "1000000", grant: "800000", actualPrice: "200000" }];
    const setForm = (values: Record<string, unknown>) =>
      act(() => {
        Object.entries(values).forEach(([key, value]) =>
          useClientWizardStore.getState().setField(key as never, value as never));
      });

    it("lets a self-pay client move from the service step to the next one", async () => {
      await renderPage(1);

      fireEvent.click(screen.getByRole("button", { name: "다음" }));

      expect(useClientWizardStore.getState().currentStep).toBe(2);
    });

    it("lets a voucher client with no type or period move on and shows no required error", async () => {
      mockVoucherPrices = PRICES;
      await renderPage(1);
      setForm({ voucherClient: true });

      fireEvent.click(screen.getByRole("button", { name: "다음" }));

      expect(useClientWizardStore.getState().currentStep).toBe(2);
      expect(screen.queryByText("바우처 유형을 선택해 주세요")).not.toBeInTheDocument();
      expect(screen.queryByText("서비스 기간을 선택해 주세요")).not.toBeInTheDocument();
    });

    it("lets a complete voucher client move on", async () => {
      mockVoucherPrices = PRICES;
      await renderPage(1);
      setForm({ voucherClient: true, type: "A가1", duration: 15 });

      fireEvent.click(screen.getByRole("button", { name: "다음" }));

      expect(useClientWizardStore.getState().currentStep).toBe(2);
    });

    const editingVoucherClient = (duration: number, endDate: string) =>
      ({
        id: 7,
        name: "박서연",
        birthday: "1990-01-01",
        dueDate: null,
        birthDate: null,
        address: "서울",
        phone: "010-1234-5678",
        primaryEmployee: null,
        secondaryEmployee: null,
        type: "A가1",
        duration,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: "2026-12-01",
        endDate,
        careCenter: false,
        voucherClient: true,
        breastPump: false,
        serviceStatus: "pre_booking",
        eDocId: null,
        areaId: null,
        hasSigned: false,
        documentStatus: null,
      }) as Client;

    const openStoredPeriodEdit = async (client: Client) => {
      mockSearchParams = new URLSearchParams("clientId=7");
      mockVoucherPrices = PRICES;
      mockUpdateClient.mockResolvedValue({ id: 7 });
      mockEditingClient = client;
      await renderPage(1);

      expect(field("duration")).toHaveValue(String(client.duration));
      expect(slotOf(field("duration"))).not.toHaveTextContent("서비스 기간을 선택해 주세요");

      fireEvent.click(screen.getByRole("button", { name: "다음" }));
      expect(useClientWizardStore.getState().currentStep).toBe(2);
    };

    it("asks for the business-day confirmation before saving an edited period whose stored duration is missing from the price list", async () => {
      // 2026-12-01 .. 2026-12-18 is 13 business days, not the stored 99.
      await openStoredPeriodEdit(editingVoucherClient(99, "2026-12-19"));
      fireEvent.change(field("endDate"), { target: { value: "2026-12-18" } });

      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await act(async () => {});

      expect(screen.getByText("서비스 기간 확인")).toBeInTheDocument();
      expect(mockUpdateClient).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "확인" }));
      await act(async () => {});

      expect(mockUpdateClient).toHaveBeenCalledTimes(1);
      expect(mockUpdateClient).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 7,
          dto: expect.objectContaining({
            duration: 99,
            endDate: "2026-12-18",
            expectedEndDate: "2026-12-19",
            allowBusinessDayMismatch: true,
          }),
        }),
      );
    });

    it("saves an unedited stored period missing from the price list without confirming or sending it", async () => {
      // 2026-12-01 .. 2026-12-19 is 14 business days, not the stored 99, but nothing is written.
      await openStoredPeriodEdit(editingVoucherClient(99, "2026-12-19"));

      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await act(async () => {});

      expect(screen.queryByText("서비스 기간 확인")).not.toBeInTheDocument();
      expect(mockUpdateClient).toHaveBeenCalledTimes(1);
      expect(mockUpdateClient).toHaveBeenCalledWith({ id: 7, dto: {} });
    });

    it("saves an edited stored period missing from the price list without confirmation when the dates match it", async () => {
      // 2026-12-02 .. 2026-12-21 is exactly the stored 14 business days.
      await openStoredPeriodEdit(editingVoucherClient(14, "2026-12-19"));
      fireEvent.change(field("startDate"), { target: { value: "2026-12-02" } });
      fireEvent.change(field("endDate"), { target: { value: "2026-12-21" } });

      fireEvent.click(screen.getByRole("button", { name: "저장" }));
      await act(async () => {});

      expect(screen.queryByText("서비스 기간 확인")).not.toBeInTheDocument();
      expect(mockUpdateClient).toHaveBeenCalledTimes(1);
      const { dto } = mockUpdateClient.mock.calls[0][0];
      expect(dto).toEqual({
        startDate: "2026-12-02",
        endDate: "2026-12-21",
        duration: 14,
        expectedEndDate: "2026-12-19",
      });
    });

    it("shows a failed voucher price lookup in the period slot", async () => {
      mockVoucherPricesError = true;
      await renderPage(1);
      setForm({ voucherClient: true, type: "A가1" });

      expect(slotOf(field("duration"))).toHaveTextContent("요금 정보를 불러오지 못했어요");
      expect(field("duration")).toBeDisabled();
      expect(field("duration")).toHaveAttribute("aria-invalid", "true");
    });

    it("shows no error in the period slot while its prices are still loading", async () => {
      mockVoucherPricesLoading = true;
      await renderPage(1);
      setForm({ voucherClient: true, type: "A가1" });

      expect(slotOf(field("duration"))).not.toHaveTextContent("서비스 기간을 선택해 주세요");
      expect(field("duration")).not.toHaveAttribute("aria-invalid", "true");
    });

    it("keeps the guidance after the customer type changes", async () => {
      await renderPage(1);
      setForm({ voucherClient: true });
      fireEvent.click(screen.getByRole("button", { name: "다음" }));
      act(() => useClientWizardStore.getState().setCurrentStep(1));

      fireEvent.click(screen.getByRole("tab", { name: "자부담 고객" }));
      fireEvent.click(screen.getByRole("tab", { name: "바우처 고객" }));

      expect(slotOf(field("type"))).toBeEmptyDOMElement();
      expect(slotOf(field("duration"))).toHaveTextContent("유형에 따라 기간이 달라져요");
    });
  });
});
