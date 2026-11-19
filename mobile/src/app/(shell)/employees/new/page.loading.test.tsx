import { act, render, screen } from "@testing-library/react";

import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";
import NewEmployeePage from "./page";

let mockPending = false;
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/hooks/useEmployees", () => ({
  useCreateEmployee: () => ({ isPending: mockPending, mutateAsync: jest.fn() }),
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/use-navigation-pending", () => ({
  useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

beforeEach(() => {
  mockPending = false;
  act(() => { useEmployeeWizardStore.getState().reset(); useEmployeeWizardStore.getState().setCurrentStep(1); });
});
afterEach(() => act(() => useEmployeeWizardStore.getState().reset()));

it("keeps the register control's classes and hides its idle label while the request is pending", () => {
  const view = render(<NewEmployeePage />);
  const idle = screen.getByRole("button", { name: "✓ 등록" });
  expect(idle).toHaveClass("actionButton", "primary");
  expect(idle).not.toHaveAttribute("aria-busy");
  mockPending = true;
  view.rerender(<NewEmployeePage />);
  const busy = screen.getByRole("button", { name: "등록 중" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveAttribute("data-loading", "");
  expect(busy).toHaveClass("actionButton", "primary", "relative");
  expect(busy.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).not.toBeNull();
  expect(busy.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(busy.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(busy.querySelector('[data-slot="button-idle"]')).toHaveTextContent("✓ 등록");
  mockPending = false;
  view.rerender(<NewEmployeePage />);
  expect(screen.getByRole("button", { name: "✓ 등록" })).not.toHaveAttribute("data-loading");
});
