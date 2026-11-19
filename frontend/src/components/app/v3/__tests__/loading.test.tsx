import { render, screen } from "@testing-library/react";

import { SteppedWizard } from "../SteppedWizard";
import { RecentActivitiesPanel } from "../RecentActivitiesPanel";
import { ServiceWorkerUpdateOverlay } from "../../ServiceWorkerUpdateOverlay";

let mockUpdating = true;
jest.mock("@/hooks/useServiceWorkerUpdate", () => ({
  useServiceWorkerUpdate: () => ({ isUpdating: mockUpdating }),
}));

it("preserves the complete action's label and width while submitting the wizard", () => {
  const props = { title: "등록", steps: [{ label: "완료", content: <div /> }], currentStep: 0, onStepChange: jest.fn(), onComplete: jest.fn(), completeLabel: "등록하기" };
  const { rerender } = render(<SteppedWizard {...props} isSubmitting />);
  const button = screen.getByRole("button", { name: "처리 중" });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("data-width", "sm");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveTextContent("등록하기");
  rerender(<SteppedWizard {...props} />);
  expect(screen.getByRole("button", { name: "등록하기" })).toBeEnabled();
});

it("announces fetching more activities through a named spinner", () => {
  render(<RecentActivitiesPanel items={[]} isLoading={false} isError={false} onRetry={jest.fn()} onSelect={jest.fn()} isFetchingMore />);
  const status = screen.getByRole("status", { name: "최근 활동 더 불러오는 중" });
  expect(status.querySelector(".sr-only")).toHaveTextContent("최근 활동 더 불러오는 중");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
});

it("keeps the update overlay with only a named spinner until the update finishes", () => {
  const { container, rerender } = render(<ServiceWorkerUpdateOverlay />);
  const status = screen.getByRole("status", { name: "앱 업데이트 중" });
  expect(status.querySelector(".sr-only")).toHaveTextContent("앱 업데이트 중");
  expect(container.querySelector("p")).toBeNull();
  expect(status.parentElement).toHaveClass("fixed", "inset-0");
  mockUpdating = false;
  rerender(<ServiceWorkerUpdateOverlay />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
