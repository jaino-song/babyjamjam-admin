import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { useClientWizardStore } from "@/stores/client-wizard-store";

import NewClientPage from "./page";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/hooks/useClients", () => ({ useCreateClient: () => ({ isPending: false, mutateAsync: jest.fn() }) }));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({ EmployeeAutocomplete: () => null }));
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

function renderedOptions() {
  const select = screen.getByLabelText("서비스 기간") as HTMLSelectElement;
  return Array.from(select.options).filter((option) => option.value).map((option) => [option.value, option.textContent]);
}

async function openServiceStep(voucherClient = true) {
  act(() => {
    const store = useClientWizardStore.getState();
    store.setField("voucherClient", voucherClient);
    store.setField("type", "A가1형");
    store.setVoucherYear(2025);
  });
  render(<QueryClientProvider client={queryClient}><NewClientPage /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText(/이름/), { target: { value: "테스트 고객" } });
  fireEvent.change(screen.getByLabelText(/연락처/), { target: { value: "01000000000" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "다음" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "다음" }));
  await screen.findByLabelText("서비스 기간");
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  act(() => useClientWizardStore.getState().reset());
  mockApiGet.mockReset();
  mockApiGet.mockImplementation(async (url, config) => {
    if (url === "/voucher-price-infos/years") return { data: [2025, 2026] };
    if (url === "/voucher-price-infos/type") {
      const { type, year } = (config?.params ?? {}) as { type?: string; year?: number };
      const durations = type === "A통합1형" || year === 2026 ? [10, 15, 20] : [5, 10, 15];
      return { data: durations.map((duration) => ({ id: duration, type, duration: String(duration), fullPrice: "1000", grant: "600", actualPrice: "400" })) };
    }
    if (url === "/out-of-pocket-price-infos") return { data: [5, 10, 15].map((duration) => ({ id: duration, duration, fullPrice: "1000" })) };
    return { data: { exists: false } };
  });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe("NewClientPage rendered voucher duration options", () => {
  it("refreshes ranked labels and numeric values on type and year changes", async () => {
    await openServiceStep();
    await waitFor(() => expect(renderedOptions()).toEqual(shortOptions));
    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "10" } });
    expect(useClientWizardStore.getState().duration).toBe(10);
    expect(screen.getByLabelText("서비스 기간")).toHaveValue("10");

    fireEvent.change(screen.getByLabelText("바우처 유형"), { target: { value: "A통합1형" } });
    await waitFor(() => expect(renderedOptions()).toEqual(longOptions));
    fireEvent.change(screen.getByLabelText("바우처 유형"), { target: { value: "A가1형" } });
    await waitFor(() => expect(renderedOptions()).toEqual(shortOptions));
    fireEvent.change(screen.getByLabelText("바우처 연도"), { target: { value: "2026" } });
    await waitFor(() => expect(renderedOptions()).toEqual(longOptions));
    expect(mockApiGet).toHaveBeenCalledWith("/voucher-price-infos/type", { params: { type: "A가1형", year: 2026 } });
    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "20" } });
    expect(useClientWizardStore.getState().duration).toBe(20);
  });

  it("keeps general-client week labels when switching away from voucher", async () => {
    await openServiceStep();
    await waitFor(() => expect(renderedOptions()).toEqual(shortOptions));
    fireEvent.click(screen.getByRole("tab", { name: "자부담 고객" }));
    await waitFor(() => expect(renderedOptions()).toEqual(generalOptions));
    expect(screen.queryByLabelText("바우처 유형")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("서비스 기간"), { target: { value: "5" } });
    expect(useClientWizardStore.getState().duration).toBe(5);
  });
});
