import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { api } from "@/lib/api/client";

import type { Client } from "@/lib/client/types";

import { ClientFormDialog, ClientFormPanel } from "../ClientFormDialog";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/hooks/useClients", () => ({
  useCreateClient: () => ({ isPending: false, mutateAsync: mockCreateClient }),
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

const prefill = {
  name: "주말서비스 테스트",
  birthday: "900101",
  dueDate: "2026-08-01",
  address: "인천시",
  phone: "01012345678",
  voucherClient: false,
  duration: 15,
  startDate: "2026-08-26",
  endDate: "2026-09-14",
  applyMessageAutomation: false,
};

async function openCreate(period = {}) {
  const onClose = jest.fn();
  render(<ClientFormDialog open onClose={onClose} prefill={{ ...prefill, ...period }} />);
  await screen.findByText("등록 가능한 번호입니다.");
  await waitFor(() => expect(screen.getByRole("button", { name: "생성" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "생성" }));
  return onClose;
}

describe("client duration confirmation", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = jest.fn();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    mockCreateClient.mockReset().mockResolvedValue({ id: 1 });
    mockUpdateClient.mockReset().mockResolvedValue({ id: 2 });
  });

  it("cancels without saving and confirms the original 15 sessions and 14-weekday dates", async () => {
    const onClose = await openCreate();
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    expect(within(modal).getByText("평일 기준으로 서비스 기간이 맞지 않습니다. 그래도 저장할까요?", { selector: "p:not(.sr-only)" })).toBeVisible();
    expect(mockCreateClient).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("시작일")).toHaveValue("260826");
    expect(screen.getByLabelText("종료일")).toHaveValue("260914");
    fireEvent.click(screen.getByRole("button", { name: "생성" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "서비스 기간 확인" })).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      duration: 15, startDate: "2026-08-26", endDate: "2026-09-14", allowBusinessDayMismatch: true,
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves a matching period directly without carrying confirmation", async () => {
    await openCreate({ endDate: "2026-09-15" });
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
    expect(mockCreateClient.mock.calls[0][0]).not.toHaveProperty("allowBusinessDayMismatch");
    expect(screen.queryByRole("dialog", { name: "서비스 기간 확인" })).not.toBeInTheDocument();
  });

  it("preserves the reported contract's 20 sessions after confirmation", async () => {
    await openCreate({ duration: 20 });
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    expect(mockCreateClient).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      duration: 20, startDate: "2026-08-26", endDate: "2026-09-14", allowBusinessDayMismatch: true,
    })));
  });

  it("also confirms a period containing only weekends and a public holiday", async () => {
    await openCreate({ startDate: "2026-08-15", endDate: "2026-08-17", duration: 3 });
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    expect(mockCreateClient).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole("button", { name: "확인" }));
    await waitFor(() => expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({
      duration: 3, startDate: "2026-08-15", endDate: "2026-08-17", allowBusinessDayMismatch: true,
    })));
  });

  it("requires confirmation in the edit panel too and prevents duplicate confirmed submissions", async () => {
    let finish!: (value: { id: number }) => void;
    mockUpdateClient.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const client: Client = {
      ...prefill, id: 2, createdAt: "2026-08-01", breastPump: false, careCenter: false,
      primaryEmployee: null, secondaryEmployee: null, serviceStatus: "completed",
      hasSigned: false, documentStatus: null, eDocId: null,
      birthDate: null, type: null, fullPrice: null, grant: null, actualPrice: null,
    };
    render(<ClientFormPanel open activeStep={3} client={client} onClose={jest.fn()} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const modal = await screen.findByRole("dialog", { name: "서비스 기간 확인" });
    expect(mockUpdateClient).not.toHaveBeenCalled();
    const confirm = within(modal).getByRole("button", { name: "확인" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    expect(mockUpdateClient).toHaveBeenCalledWith({ id: 2, dto: expect.objectContaining({
      duration: 15, startDate: "2026-08-26", endDate: "2026-09-14", allowBusinessDayMismatch: true,
    }) });
    await act(async () => { finish({ id: 2 }); });
  });
});
