import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const baseClient: Client = {
  id: 91,
  name: "자동 문자 고객",
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
  bookingConfirmedAt: null,
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

const openForm = async (client: Client) => {
  render(<ClientFormDialog open client={client} onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByLabelText(/이름/)).toHaveValue(client.name));
  await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeEnabled());
};

describe("ClientFormDialog 메시지 자동 전송 switch in edit mode", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockUpdateClient.mockReset();
    mockUpdateClient.mockResolvedValue(baseClient);
  });

  it("shows the switch on for a client that has no stored flag and sends nothing when untouched", async () => {
    await openForm(baseClient);

    expect(screen.getByRole("switch", { name: "메시지 자동 전송" })).toBeChecked();
    expect(
      screen.queryByText("끄면 이 대상에게 자동 문자가 발송되지 않아요. 직접 발송은 가능해요."),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천시 연수구" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient.mock.calls[0][0].dto).toEqual({ address: "인천시 연수구" });
  });

  it("reflects a stored false flag and sends only smsAutomationEnabled when it is switched back on", async () => {
    await openForm({ ...baseClient, smsAutomationEnabled: false });

    const automationSwitch = screen.getByRole("switch", { name: "메시지 자동 전송" });
    expect(automationSwitch).not.toBeChecked();

    fireEvent.click(automationSwitch);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    const { dto } = mockUpdateClient.mock.calls[0][0];
    expect(dto).toEqual({ smsAutomationEnabled: true });
    expect(dto).not.toHaveProperty("applyMessageAutomation");
  });

  it("sends smsAutomationEnabled false without applyMessageAutomation when switched off", async () => {
    await openForm(baseClient);

    fireEvent.click(screen.getByRole("switch", { name: "메시지 자동 전송" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    const { dto } = mockUpdateClient.mock.calls[0][0];
    expect(dto).toEqual({ smsAutomationEnabled: false });
    expect(dto).not.toHaveProperty("applyMessageAutomation");
  });
});
