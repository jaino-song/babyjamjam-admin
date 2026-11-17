import { render, screen } from "@testing-library/react";

import { EmployeeScheduleManager } from "./EmployeeScheduleManager";

let mockLoading = true;

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: mockLoading ? undefined : [], isLoading: mockLoading }),
}));
jest.mock("@/components/app/clients/ClientDetailPanel", () => ({ ClientDetailPanel: () => null }));

it("announces schedule loading through a spinner inside the existing white card", () => {
  mockLoading = true;
  render(<EmployeeScheduleManager data-component="desktop_employees_schedule" />);
  const status = screen.getByRole("status", { name: "일정 로딩 중" });
  expect(status).toHaveAttribute("data-source-component", "LoadingState");
  expect(status.querySelector(".sr-only")).toHaveTextContent("일정 로딩 중");
  expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(status.parentElement).toHaveClass("rounded-[28px]", "bg-white", "shadow-v3");
  expect(screen.queryByText("일정 불러오는 중…")).not.toBeInTheDocument();
});

it("uses scaled 32/44 icon buttons for month navigation", () => {
  mockLoading = false;
  render(<EmployeeScheduleManager data-component="desktop_employees_schedule" />);
  for (const name of ["이전 달", "다음 달"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toHaveAttribute("data-size", "icon");
    expect(button).toHaveClass("h-[calc(32px*var(--glint-ui-scale,1))]", "after:h-[calc(44px*var(--glint-ui-scale,1))]");
  }
});
