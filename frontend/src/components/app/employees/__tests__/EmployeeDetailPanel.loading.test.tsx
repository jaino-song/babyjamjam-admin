import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Employee } from "@/hooks/useEmployees";
import { EmployeeDetailPanel } from "../EmployeeDetailPanel";

const mockWorkHistory = jest.fn();
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useEmployees", () => ({
  useEmployeeActiveClients: () => ({ data: [], isLoading: false, isError: false }),
  useEmployeeWorkHistory: () => mockWorkHistory(),
  useToggleEmployeeOpenStatus: () => ({ isPending: false }),
}));

const employee: Employee = {
  id: 7, name: "QA-제공인력", workArea: [], phone: "", grade: "A",
  openToNextWork: true, registeredDate: "2026-08-27", status: "available",
};

it("replaces the work-history load-more label with an accessible spinner until fetching finishes", () => {
  const fetchNextPage = jest.fn();
  const query = {
    history: [{ scheduleId: 1, clientName: "QA-고객", startDate: "2026-01-01", endDate: "2026-01-02", role: "primary", status: "completed" }],
    isLoading: false, isError: false, hasNextPage: true, isFetchingNextPage: false, fetchNextPage,
  };
  mockWorkHistory.mockReturnValue(query);
  const panel = <EmployeeDetailPanel employee={employee} canManage={false} onEdit={jest.fn()} onDelete={jest.fn()} />;
  const { rerender } = render(panel);
  fireEvent.click(screen.getByRole("tab", { name: "근무 내역" }));
  const idle = screen.getByRole("button", { name: "더 보기" });
  expect(idle).toBeEnabled();
  expect(idle).not.toHaveAttribute("aria-busy");
  fireEvent.click(idle);
  expect(fetchNextPage).toHaveBeenCalledTimes(1);

  mockWorkHistory.mockReturnValue({ ...query, isFetchingNextPage: true });
  rerender(<EmployeeDetailPanel employee={employee} canManage={false} onEdit={jest.fn()} onDelete={jest.fn()} />);
  const busy = screen.getByRole("button", { name: "불러오는 중" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy).toHaveAttribute("data-loading", "");
  const label = busy.querySelector('[data-slot="button-idle"]');
  expect(label).toHaveTextContent("더 보기");
  expect(label).toHaveAttribute("aria-hidden", "true");
  expect(label).toHaveClass("contents", "invisible");
  expect(busy.querySelector('[data-slot="button-spinner"] [data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(within(busy).getByText("불러오는 중")).toHaveClass("sr-only");
  fireEvent.click(busy);
  expect(fetchNextPage).toHaveBeenCalledTimes(1);

  mockWorkHistory.mockReturnValue(query);
  rerender(<EmployeeDetailPanel employee={employee} canManage={false} onEdit={jest.fn()} onDelete={jest.fn()} />);
  const restored = screen.getByRole("button", { name: "더 보기" });
  expect(restored).toBeEnabled();
  expect(restored).not.toHaveAttribute("aria-busy");
  expect(restored).not.toHaveAttribute("data-loading");
  expect(restored.querySelector('[data-slot="button-spinner"]')).toBeNull();
});
