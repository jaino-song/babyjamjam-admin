import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";

import { ClientFormPanel } from "../ClientFormDialog";

const mockCreateClient = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));

jest.mock("@/hooks/useVoucherData", () => ({
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/stores/client-dialog-store", () => {
  const state = { prefillName: "", clearPrefillName: jest.fn() };

  return {
    useClientDialogStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("../EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: () => <div data-testid="employee-autocomplete" />,
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;

describe("ClientFormPanel optional service information", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset();
    mockCreateClient.mockResolvedValue({ id: 1 });
  });

  it("creates a pre-booking client without voucher or contract information", async () => {
    const onClose = jest.fn();
    render(<ClientFormPanel open onClose={onClose} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "상담고객" } });
    fireEvent.change(screen.getByLabelText(/생년월일/), { target: { value: "900101" } });
    fireEvent.change(screen.getByLabelText(/출산 예정일/), { target: { value: "261201" } });
    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "서울시 강남구" } });
    fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01012345678" } });

    await screen.findByText("등록 가능한 번호입니다.");
    await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "다음" }));
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByLabelText("바우처 유형")).toHaveValue("");
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "다음" }));

    expect(screen.getByLabelText("계약 상태")).toHaveValue("pre_booking");
    expect(screen.getByLabelText("시작일")).toHaveValue("");
    expect(screen.getByRole("button", { name: "생성" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => {
      expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        voucherClient: false,
        serviceStatus: "pre_booking",
      }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
