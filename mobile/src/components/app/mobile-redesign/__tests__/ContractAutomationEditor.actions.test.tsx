import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";

import { ContractAutomationEditor } from "../ContractAutomationEditor";

jest.mock("@/services/api", () => ({ settingsApi: { getContractAutomationPolicies: jest.fn(), updateContractAutoFinalizeConfig: jest.fn() } }));

it("puts revert before save with one-third and two-thirds widths", () => {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  client.setQueryData(["settings", "contract-automation-policies"], { autoFinalize: { enabled: true, graceDays: 0, maxAttempts: 3 } });
  render(<QueryClientProvider client={client}><ContractAutomationEditor onClose={jest.fn()} /></QueryClientProvider>);
  const revert = screen.getByRole("button", { name: "되돌리기" });
  const save = screen.getByRole("button", { name: "저장" });
  expect(Array.from(save.parentElement!.children)).toEqual([revert, save]);
  expect(revert).toHaveClass("flex-1", "min-h-11");
  expect(save.parentElement).toHaveClass("grid", "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]");
  expect(save).toHaveClass("flex-[2]", "min-h-11");
});
