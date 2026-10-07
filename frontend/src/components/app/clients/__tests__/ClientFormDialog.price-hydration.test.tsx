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

jest.mock("@/hooks/useVoucherData", () => ({
  useAvailableClientAreas: () => ({ data: [], isLoading: false }),
  useAreaTemplates: () => ({ data: [], isLoading: false }),
  useOutOfPocketPriceInfos: () => ({ data: mockOutOfPocketPriceInfos, isError: false, isLoading: false }),
  useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
  useVoucherYears: () => ({ data: [], isLoading: false }),
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
const client: Client = {
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
  fullPrice: null,
  grant: null,
  actualPrice: null,
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

const openForm = async () => {
  render(<ClientFormDialog open client={client} onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue(client.name));
  await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());
};

const waitForHydratedPrice = () =>
  waitFor(() => expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("1,620,000"));

// The client above has no stored prices, so the form's price table fills 1,620,000 in when it
// opens. That is the form catching up with its own table, not an edit by staff.
describe("ClientFormDialog price hydration is not a user edit", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockUpdateClient.mockReset();
    mockUpdateClient.mockResolvedValue(client);
  });

  it("sends an empty update on a no-op save even though the price table filled the prices", async () => {
    await openForm();
    await waitForHydratedPrice();

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({ id: client.id, dto: {} });
  });

  it("sends only the address for an address-only edit, so a newer price is not overwritten", async () => {
    await openForm();
    await waitForHydratedPrice();

    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천시 연수구" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: client.id,
      dto: { address: "인천시 연수구" },
    });
  });

  it("sends a price the user typed", async () => {
    await openForm();
    await waitForHydratedPrice();

    fireEvent.change(screen.getByLabelText("총 서비스 금액"), { target: { value: "1,700,000" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: client.id,
      dto: { fullPrice: "1700000", actualPrice: "1700000" },
    });
  });

  it("sends the period, the opening end date and the recomputed prices when the duration changes", async () => {
    await openForm();
    await waitForHydratedPrice();

    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "5" } });
    await waitFor(() => expect(screen.getByLabelText("총 서비스 금액")).toHaveValue("815,000"));
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-06"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: client.id,
      dto: {
        duration: 5,
        startDate: "2026-11-02",
        endDate: "2026-11-06",
        expectedEndDate: "2026-11-13",
        fullPrice: "815000",
        actualPrice: "815000",
      },
    });
  });
});
