import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import { settingsApi } from "@/services/api";

import { ContractAutomationEditor } from "../ContractAutomationEditor";
import { DashboardRedesign } from "../DashboardRedesign";

jest.mock("@/services/api", () => ({
  settingsApi: {
    getContractAutomationPolicies: jest.fn(),
    updateContractAutoFinalizeConfig: jest.fn(),
  },
}));

it.each(["analytics", "activity"])("centers the retry spinner for %s and hides the idle label", (section) => {
  render(<DashboardRedesign analytics={[]} sections={[]} filters={[]} loadMore={false}
    isError={section === "activity"} isRetrying={section === "activity"}
    isAnalyticsError={section === "analytics"} isRetryingAnalytics={section === "analytics"} />);

  const button = screen.getByRole("button", { name: "다시 시도 중" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-spinner"]')).toHaveClass("absolute", "inset-0");
});

it("keeps the contract save label hidden while the save is in flight", async () => {
  jest.mocked(settingsApi.getContractAutomationPolicies).mockResolvedValue({ autoFinalize: { enabled: true, graceDays: 0, maxAttempts: 3 } });
  jest.mocked(settingsApi.updateContractAutoFinalizeConfig).mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><ContractAutomationEditor onClose={jest.fn()} /></QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText("실행 시점"), { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));

  const button = await screen.findByRole("button", { name: "저장 중" });
  expect(button).toBeDisabled();
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("저장");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  view.unmount();
  client.clear();
});
