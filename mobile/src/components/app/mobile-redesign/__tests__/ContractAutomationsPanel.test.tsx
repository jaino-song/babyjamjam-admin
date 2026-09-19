import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContractAutomationsPanel, type ContractAutoFinalizeConfig } from "../ContractAutomationsPanel";
import { settingsApi } from "@/services/api";

jest.mock("@/services/api", () => ({
  settingsApi: {
    getContractAutomationPolicies: jest.fn(),
    updateContractAutoFinalizeConfig: jest.fn(),
  },
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));

const getPolicies = settingsApi.getContractAutomationPolicies as jest.Mock;
const updateConfig = settingsApi.updateContractAutoFinalizeConfig as jest.Mock;

function renderPanel(onEdit = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><ContractAutomationsPanel data-component="contracts-automation" onEdit={onEdit} /></QueryClientProvider>);
}

describe("ContractAutomationsPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPolicies.mockResolvedValue({ autoFinalize: { enabled: true, graceDays: 3, maxAttempts: 5 } });
    updateConfig.mockResolvedValue({ enabled: false, graceDays: 3, maxAttempts: 5 });
  });

  it("renders the rule summary and toggles the saved config", async () => {
    renderPanel();
    expect(await screen.findByText("계약 종료일 자동 완료")).toBeInTheDocument();
    expect(screen.getByText("검토 필요 → 계약 완료 · 종료일 3일 후 · 매일 17:00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "계약 종료일 자동 완료 활성화" }));
    await waitFor(() => expect(updateConfig.mock.calls[0]?.[0]).toEqual({ enabled: false, graceDays: 3, maxAttempts: 5 }));
  });

  it("keeps the edit row and switch as separate buttons", async () => {
    const { container } = renderPanel();
    const row = await screen.findByRole("button", { name: /계약 종료일 자동 완료/ });
    const switchControl = screen.getByRole("switch", { name: "계약 종료일 자동 완료 활성화" });

    expect(row.querySelector("button")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(2);
    expect(row).toHaveAttribute("data-component", "contracts-automation_row");
    expect(row).toHaveAttribute("data-source-component", "ListItemRow");
    expect(switchControl).toHaveAttribute("data-component", "contracts-automation_row_switch");
  });

  it("routes row click and Enter to edit without toggling the saved config", async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    renderPanel(onEdit);
    const row = await screen.findByRole("button", { name: /계약 종료일 자동 완료/ });

    await user.click(row);
    row.focus();
    await user.keyboard("{Enter}");

    expect(onEdit).toHaveBeenCalledTimes(2);
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it("routes switch click and Space to the complete saved config without editing", async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    renderPanel(onEdit);
    const switchControl = await screen.findByRole("switch", { name: "계약 종료일 자동 완료 활성화" });
    const savedConfig = { enabled: false, graceDays: 3, maxAttempts: 5 };

    await user.click(switchControl);
    await waitFor(() => expect(updateConfig.mock.calls[0]?.[0]).toEqual(savedConfig));

    switchControl.focus();
    await user.keyboard("[Space]");
    await waitFor(() => expect(updateConfig.mock.calls[1]?.[0]).toEqual(savedConfig));

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("tabs from the edit row to the switch control", async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    const row = await screen.findByRole("button", { name: /계약 종료일 자동 완료/ });
    const switchControl = screen.getByRole("switch", { name: "계약 종료일 자동 완료 활성화" });

    expect(Array.from(container.querySelectorAll("button"))).toEqual([row, switchControl]);
    await user.tab();
    expect(row).toHaveFocus();
    await user.tab();
    expect(switchControl).toHaveFocus();
  });

  it("disables the switch while the saved config is pending", async () => {
    let resolveUpdate: ((value: ContractAutoFinalizeConfig) => void) | undefined;
    updateConfig.mockImplementationOnce(() => new Promise<ContractAutoFinalizeConfig>((resolve) => {
      resolveUpdate = resolve;
    }));
    renderPanel();
    const switchControl = await screen.findByRole("switch", { name: "계약 종료일 자동 완료 활성화" });

    fireEvent.click(switchControl);
    await waitFor(() => expect(switchControl).toBeDisabled());
    resolveUpdate?.({ enabled: false, graceDays: 3, maxAttempts: 5 });
  });

  it("preserves the loading branch", () => {
    getPolicies.mockImplementationOnce(() => new Promise(() => {}));
    const { container } = renderPanel();

    expect(container.querySelector('[data-component="contracts-automation_loading"]')).toBeInTheDocument();
    expect(screen.queryByText("계약 종료일 자동 완료")).not.toBeInTheDocument();
  });

  it("preserves the error branch", async () => {
    getPolicies.mockRejectedValueOnce(new Error("failed"));
    const { container } = renderPanel();

    expect(await screen.findByText("자동화 설정을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(container.querySelector('[data-component="contracts-automation_error"]')).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "계약 종료일 자동 완료 활성화" })).not.toBeInTheDocument();
  });
});
