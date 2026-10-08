import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

import { ClientFormDialog } from "../ClientFormDialog";

const mockUpdateClient = jest.fn();

const mockOutOfPocketPriceInfos = [
  { id: 1, duration: 5, fullPrice: "815000" },
  { id: 2, duration: 10, fullPrice: "1620000" },
  { id: 3, duration: 15, fullPrice: "2425000" },
];

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: mockUpdateClient }),
}));

const mockVoucherPriceInfosByYear: Record<number, Array<Record<string, string | number>>> = {
  2026: [{ id: 1, type: "A가1형", duration: "10", fullPrice: "1,500,000", grant: "1,050,000", actualPrice: "450,000" }],
  2027: [{ id: 2, type: "A가1형", duration: "10", fullPrice: "1,600,000", grant: "1,100,000", actualPrice: "500,000" }],
};

jest.mock("@/hooks/useVoucherData", () => ({
  useAvailableClientAreas: () => ({ data: [], isLoading: false }),
  useAreaTemplates: () => ({ data: [], isLoading: false }),
  useOutOfPocketPriceInfos: () => ({ data: mockOutOfPocketPriceInfos, isError: false, isLoading: false }),
  useVoucherPriceInfos: (type: string, year: number) => ({
    data: type ? mockVoucherPriceInfosByYear[year] ?? [] : [],
    isLoading: false,
  }),
  useVoucherYears: () => ({ data: [2026, 2027], isLoading: false }),
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

// 2026-11-02 (Mon) .. 2026-11-13 (Fri) is exactly 10 business days.
const savedClient: Client = {
  id: 77,
  name: "홍길동",
  createdAt: "2026-10-01",
  birthday: "1990-01-01",
  dueDate: "2026-10-20",
  birthDate: null,
  address: "인천시 남동구",
  phone: "01012345678",
  primaryEmployee: null,
  secondaryEmployee: null,
  type: null,
  duration: 10,
  fullPrice: "1700000",
  grant: "0",
  actualPrice: "1700000",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const savedVoucherClient: Client = {
  ...savedClient,
  type: "A가1형",
  fullPrice: "1500000",
  grant: "1050000",
  actualPrice: "450000",
  voucherClient: true,
};

const openForm = async (client: Client) => {
  render(<ClientFormDialog open client={client} onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue(client.name));
  await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());
};

const selectById = (id: string) => document.getElementById(id) as HTMLSelectElement;

// Once staff change a price driver, the price table re-prices the form. Landing back on the
// opening driver values does not make that a no-op: the prices shown must be what gets saved.
describe("ClientFormDialog price baseline is frozen after the first price edit or driver change", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockUpdateClient.mockReset();
    mockUpdateClient.mockResolvedValue(savedClient);
  });

  it("sends the table price after the duration goes 10 -> 5 -> 10 on a client with a saved price", async () => {
    await openForm(savedClient);
    expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,700,000");

    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "5" } });
    await waitFor(() => expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("815,000"));
    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,620,000"));
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-13"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: savedClient.id,
      dto: { fullPrice: "1620000", actualPrice: "1620000" },
    });
  });

  it("sends the new year's prices after the voucher year is changed and the duration reselected", async () => {
    await openForm(savedVoucherClient);
    expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,500,000");

    fireEvent.change(selectById("clients-form-voucher-year"), { target: { value: "2027" } });
    await waitFor(() => expect(screen.getByLabelText("서비스 기간")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "10" } });
    await waitFor(() => expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,600,000"));
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-13"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: savedClient.id,
      dto: { fullPrice: "1600000", grant: "1100000", actualPrice: "500000" },
    });
  });
});
