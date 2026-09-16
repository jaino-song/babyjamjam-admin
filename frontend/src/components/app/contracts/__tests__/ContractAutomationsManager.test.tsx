import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ContractAutomationsManager } from "../ContractAutomationsManager";
import { settingsApi } from "@/services/api";

jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/services/api", () => ({
  settingsApi: {
    getContractAutomationPolicies: jest.fn(),
    updateContractAutoFinalizeConfig: jest.fn(),
  },
}));
jest.mock("@/components/ui/title-select-molecule", () => ({
  TitleSelectMolecule: ({ label, value, options, onValueChange }: { label: string; value?: string; options: Array<{ value: string; label: string }>; onValueChange: (value: string) => void }) => (
    <label>{label}<select aria-label={label} value={value} onChange={(event) => onValueChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
  ),
}));

const getPolicies = settingsApi.getContractAutomationPolicies as jest.Mock;
const updateConfig = settingsApi.updateContractAutoFinalizeConfig as jest.Mock;

function renderManager() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><ContractAutomationsManager dataComponent="test-contract-automations" /></QueryClientProvider>);
}

describe("ContractAutomationsManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPolicies.mockResolvedValue({ autoFinalize: { enabled: true, graceDays: 0, maxAttempts: 3 } });
    updateConfig.mockResolvedValue({ enabled: true, graceDays: 0, maxAttempts: 3 });
  });

  it("renders the rule row from query data", async () => {
    renderManager();
    expect((await screen.findAllByText("계약 종료일 자동 완료")).length).toBeGreaterThan(0);
    expect(screen.getByText(/검토 필요 → 계약 완료/)).toBeInTheDocument();
  });

  it("toggles the rule immediately", async () => {
    renderManager();
    fireEvent.click(await screen.findByText("계약 종료일 자동 완료"));
    const toggle = await screen.findByRole("switch", { name: "계약 종료일 자동 완료 활성화" });
    fireEvent.click(toggle);
    await waitFor(() => expect(updateConfig.mock.calls[0]?.[0]).toEqual({ enabled: false, graceDays: 0, maxAttempts: 3 }));
  });

  it("enables save when execution timing changes and saves the new grace days", async () => {
    renderManager();
    fireEvent.click(await screen.findByText("계약 종료일 자동 완료"));
    const select = await screen.findByRole("combobox", { name: "실행 시점" });
    fireEvent.change(select, { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "저장" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(updateConfig.mock.calls[0]?.[0]).toEqual({ enabled: true, graceDays: 3, maxAttempts: 3 }));
  });

  it("shows a retryable query error and uses the saved grace days after retry", async () => {
    getPolicies
      .mockRejectedValueOnce(new Error("settings unavailable"))
      .mockResolvedValueOnce({ autoFinalize: { enabled: true, graceDays: 7, maxAttempts: 5 } });

    renderManager();

    expect(await screen.findByRole("alert")).toHaveTextContent("자동화 설정을 불러오지 못했습니다");
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    expect(screen.queryByText(/종료일 7일 후/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(getPolicies).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/종료일 7일 후/)).toBeInTheDocument();
  });

  it("describes the saved grace days in the explanation tab", async () => {
    getPolicies.mockResolvedValue({ autoFinalize: { enabled: true, graceDays: 3, maxAttempts: 5 } });

    renderManager();
    fireEvent.click(await screen.findByText("계약 종료일 자동 완료"));
    fireEvent.click(screen.getByRole("tab", { name: "동작 설명" }));

    expect(await screen.findByText(/실행 시점은 종료일 3일 후입니다/)).toBeInTheDocument();
  });
});
