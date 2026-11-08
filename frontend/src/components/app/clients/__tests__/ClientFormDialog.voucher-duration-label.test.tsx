import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import type { Client } from "@/lib/client/types";

import { ClientFormDialog, ClientFormPanel } from "../ClientFormDialog";

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => new URLSearchParams() }));
jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useUpdateClient: () => ({ isPending: false, mutateAsync: jest.fn() }),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("../EmployeeAutocomplete", () => ({ EmployeeAutocomplete: () => null }));
jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({ EmployeeFormDialog: () => null }));
jest.mock("@/stores/client-dialog-store", () => {
  const state = { prefillName: "", clearPrefillName: jest.fn() };
  return { useClientDialogStore: (selector: (value: typeof state) => unknown) => selector(state) };
});
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

const mockApiGet = jest.mocked(api.get);
let queryClient: QueryClient;
const shortOptions = [["5", "5일 (단축형)"], ["10", "10일 (표준형)"], ["15", "15일 (연장형)"]];
const longOptions = [["10", "10일 (단축형)"], ["15", "15일 (표준형)"], ["20", "20일 (연장형)"]];
const generalOptions = [["5", "1주 (5일)"], ["10", "2주 (10일)"], ["15", "3주 (15일)"]];
const savedClient: Client = {
  id: 1, name: "테스트 고객", createdAt: "2025-01-01", birthday: "900101", dueDate: null, birthDate: null,
  address: "테스트 주소", phone: "010-0000-0000", primaryEmployee: null, secondaryEmployee: null,
  type: "A가1형", duration: 10, fullPrice: "1000", grant: "600", actualPrice: "400", startDate: null,
  endDate: "2025-12-15T00:00:00.000Z", careCenter: false, voucherClient: true, breastPump: false,
  serviceStatus: "waiting", bookingConfirmedAt: null, eDocId: null, hasSigned: false, documentStatus: null,
};

function renderedOptions() {
  const select = screen.getByLabelText("서비스 기간") as HTMLSelectElement;
  return Array.from(select.options).filter((option) => option.value).map((option) => [option.value, option.textContent]);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockApiGet.mockReset();
  mockApiGet.mockImplementation(async (url, config) => {
    if (url === "/voucher-price-infos/years") return { data: [2025, 2026] };
    if (url === "/voucher-price-infos/type") {
      const { type, year } = (config?.params ?? {}) as { type?: string; year?: number };
      const durations = type === "A통합1형" || year === 2026 ? [10, 15, 20] : [5, 10, 15];
      return { data: durations.map((duration) => ({ id: duration, type, duration: String(duration), fullPrice: "1000", grant: "600", actualPrice: "400" })) };
    }
    if (url === "/out-of-pocket-price-infos") return { data: [5, 10, 15].map((duration) => ({ id: duration, duration, fullPrice: "1000" })) };
    if (url === "/area-templates/available-areas") return { data: [] };
    return { data: { exists: false } };
  });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe.each(["dialog", "panel"] as const)("ClientForm %s real duration select", (surface) => {
  it.each(["create", "edit"] as const)("refreshes literal labels and numeric values in %s mode", async (mode) => {
    const props = { open: true, onClose: jest.fn(), client: mode === "edit" ? savedClient : undefined };
    render(<QueryClientProvider client={queryClient}>
      {surface === "dialog" ? <ClientFormDialog {...props} /> : <ClientFormPanel {...props} activeStep={2} />}
    </QueryClientProvider>);
    await screen.findByLabelText("서비스 기간");
    if (mode === "create") {
      fireEvent.click(screen.getByRole("tab", { name: "바우처 고객" }));
      fireEvent.change(screen.getByLabelText("바우처 연도"), { target: { value: "2025" } });
      fireEvent.change(screen.getByLabelText("바우처 유형"), { target: { value: "A가1형" } });
    }
    await waitFor(() => expect(renderedOptions()).toEqual(shortOptions));
    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "10" } });
    expect(screen.getByLabelText("서비스 기간")).toHaveValue("10");

    fireEvent.change(screen.getByLabelText("바우처 유형"), { target: { value: "A통합1형" } });
    fireEvent.change(screen.getByLabelText("바우처 연도"), { target: { value: "2025" } });
    await waitFor(() => expect(renderedOptions()).toEqual(longOptions));
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A통합1형", year: 2025 } });
    fireEvent.change(screen.getByLabelText("바우처 유형"), { target: { value: "A가1형" } });
    // Type changes clear the explicit year and end date; choose the historical year again.
    fireEvent.change(screen.getByLabelText("바우처 연도"), { target: { value: "2025" } });
    await waitFor(() => expect(renderedOptions()).toEqual(shortOptions));
    fireEvent.change(screen.getByLabelText("바우처 연도"), { target: { value: "2026" } });
    await waitFor(() => expect(renderedOptions()).toEqual(longOptions));
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2026 } });
    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "20" } });
    expect(screen.getByLabelText("서비스 기간")).toHaveValue("20");

    fireEvent.click(screen.getByRole("tab", { name: "자부담 고객" }));
    await waitFor(() => expect(renderedOptions()).toEqual(generalOptions));
    expect(screen.queryByLabelText("바우처 유형")).not.toBeInTheDocument();
  });
});
