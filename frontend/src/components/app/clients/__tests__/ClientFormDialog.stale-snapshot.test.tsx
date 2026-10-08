import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProblemDetails } from "@babyjamjam/shared";

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

describe("ClientFormDialog edit saves do not write back a stale snapshot", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockUpdateClient.mockReset();
    mockUpdateClient.mockResolvedValue(client);
  });

  it("sends only the address, with no date fields, for an address-only edit", async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천시 연수구" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: client.id,
      dto: { address: "인천시 연수구" },
    });
  });

  it("sends the whole service period and the opening end date when the start date changes", async () => {
    await openForm();

    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-11-03" } });
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-16"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({
      id: client.id,
      dto: {
        startDate: "2026-11-03",
        endDate: "2026-11-16",
        duration: 10,
        expectedEndDate: "2026-11-13",
      },
    });
  });

  it("still sends an empty update when nothing changed, so the backend phone relink runs", async () => {
    await openForm();

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    expect(mockUpdateClient).toHaveBeenCalledWith({ id: client.id, dto: {} });
  });

  it("tells staff to reopen the form when the backend reports the end date moved", async () => {
    mockUpdateClient.mockRejectedValue({
      response: {
        status: 409,
        data: createProblemDetails({
          code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
          requestId: "req-end-date-moved",
          status: 409,
        }),
      },
    });
    await openForm();

    fireEvent.change(screen.getByLabelText("시작일"), { target: { value: "2026-11-03" } });
    await waitFor(() => expect(screen.getByLabelText("종료일")).toHaveValue("2026-11-16"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText(
      "그동안 서비스 종료일이 바뀌어 저장하지 않았어요. 창을 닫고 다시 열어 최신 정보로 수정해 주세요.",
    )).toBeInTheDocument();
    // The edit stays in the form; nothing was applied and the form is not closed under the user.
    expect(screen.getByLabelText("시작일")).toHaveValue("2026-11-03");
  });

  it("does not claim the end date moved when the rejected save carried no end-date guard", async () => {
    mockUpdateClient.mockRejectedValue({
      response: {
        status: 409,
        data: createProblemDetails({
          code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
          requestId: "req-other-conflict",
          status: 409,
        }),
      },
    });
    await openForm();

    fireEvent.change(screen.getByLabelText(/주소/), { target: { value: "인천시 연수구" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(mockUpdateClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText(/서비스 종료일이 바뀌어/)).not.toBeInTheDocument();
  });
});
