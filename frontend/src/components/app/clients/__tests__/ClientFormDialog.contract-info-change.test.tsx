import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "@/test-utils/render-client-form";

import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

import { ClientFormDialog } from "../ClientFormDialog";

const mockUpdateClient = jest.fn();

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
  useOutOfPocketPriceInfos: () => ({ data: [], isError: false, isLoading: false }),
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

// A client whose contract is completed. Its 10 sessions run 2026-11-02 to 2026-11-17 (12 business
// days, a delayed client), so an end-date edit also asks the service-period question first.
const contractedClient: Client = {
  id: 79,
  name: "QA-계약완료",
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
  endDate: "2026-11-17",
  careCenter: false,
  voucherClient: false,
  breastPump: false,
  serviceStatus: "pre_booking",
  bookingConfirmedAt: null,
  eDocId: "QA-doc",
  hasSigned: true,
  documentStatus: "completed",
};

const openForm = async (client: Client = contractedClient) => {
  render(<ClientFormDialog open client={client} onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue(client.name));
  await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());
};

describe("ClientFormDialog confirmation before changing a completed contract's fields", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockUpdateClient.mockReset();
    mockUpdateClient.mockResolvedValue(contractedClient);
  });

  it("asks first, lists the changed field, and saves on 수정", async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천시 연수구" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const modal = await screen.findByRole("dialog", { name: "확인이 필요해요" });
    expect(mockUpdateClient).not.toHaveBeenCalled();
    expect(within(modal).getByText("계약서가 완료된 상태여서 계약서는 변경할 수 없어요. 그래도 수정할까요?")).toBeVisible();
    expect(within(modal).getByText("계약서와 달라지는 수정 사항")).toBeInTheDocument();
    const row = within(modal).getByText("주소").closest("[data-field]");
    expect(row).toHaveAttribute("data-field", "address");
    expect(within(row as HTMLElement).getByText("인천시 남동구").tagName).toBe("DEL");
    expect(within(row as HTMLElement).getByText("인천시 연수구").tagName).toBe("STRONG");

    fireEvent.click(within(modal).getByRole("button", { name: "수정" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: contractedClient.id,
      dto: { address: "인천시 연수구" },
    });
  });

  it("saves nothing on 취소", async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천시 연수구" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const modal = await screen.findByRole("dialog", { name: "확인이 필요해요" });
    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "확인이 필요해요" })).not.toBeInTheDocument());
    expect(mockUpdateClient).not.toHaveBeenCalled();
  });

  it("saves a field the contract does not carry without asking", async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText(/출산 예정일/), { target: { value: "2026-10-21" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "확인이 필요해요" })).not.toBeInTheDocument();
  });

  it("does not ask when the contract is not completed", async () => {
    await openForm({ ...contractedClient, documentStatus: "requested" });

    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천시 연수구" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "확인이 필요해요" })).not.toBeInTheDocument();
  });

  it("keeps the service-period confirmation when an end-date edit is confirmed twice", async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText("종료일"), { target: { value: "2026-11-18" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "서비스 기간 확인" })).getByRole("button", { name: "확인" }));

    const modal = await screen.findByRole("dialog", { name: "확인이 필요해요" });
    const row = within(modal).getByText("종료일").closest("[data-field]") as HTMLElement;
    expect(within(row).getByText("2026.11.17")).toBeInTheDocument();
    expect(within(row).getByText("2026.11.18")).toBeInTheDocument();
    expect(mockUpdateClient).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole("button", { name: "수정" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: contractedClient.id,
      dto: expect.objectContaining({ endDate: "2026-11-18", allowBusinessDayMismatch: true }),
    });
  });
});
