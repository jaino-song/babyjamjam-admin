import { act, fireEvent, render, screen } from "@testing-library/react";

import type { Employee } from "@/hooks/useEmployees";
import { EmployeeDetailPanel } from "./EmployeeDetailPanel";

const mockOpenStatusMutate = jest.fn();

jest.mock("@/hooks/useEmployees", () => ({
  useEmployeeActiveClients: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
  useEmployeeWorkHistory: () => ({ history: [], isLoading: false, isError: false, refetch: jest.fn(), hasNextPage: false }),
  useToggleEmployeeOpenStatus: () => ({ isPending: false, mutate: mockOpenStatusMutate }),
}));

jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled, ...props }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
}));

jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

jest.mock("@/components/app/ui/status-badge", () => ({
  StatusPill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

jest.mock("@/components/app/v3", () => ({
  AnimatedSlotList: () => null,
  AnimatedSlotListItemContent: () => null,
  DetailPanel: ({ children, trailing, tabs }: { children: React.ReactNode; trailing?: React.ReactNode; tabs?: React.ReactNode }) => (
    <section>{trailing}{tabs}{children}</section>
  ),
  DetailTabPanels: ({ panels, activeTab }: { panels: Array<{ key: string; children: React.ReactNode }>; activeTab: string }) => (
    <>{panels.find((panel) => panel.key === activeTab)?.children}</>
  ),
  DetailTabs: () => null,
  InfoCard: ({ children, title }: { children: React.ReactNode; title?: string }) => <section>{title ? <h2>{title}</h2> : null}{children}</section>,
  InfoRow: ({ label, value }: { label: string; value: React.ReactNode }) => <div><span>{label}</span><span>{value}</span></div>,
  ListEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));

const employee: Employee = {
  id: 7,
  name: "홍길동",
  workArea: ["gangnam"],
  phone: "01012345678",
  grade: "A",
  openToNextWork: true,
  registeredDate: "2026-08-27T00:00:00.000Z",
  status: "available",
};

describe("EmployeeDetailPanel availability action", () => {
  beforeEach(() => mockOpenStatusMutate.mockReset());

  it("lets staff toggle open status while hiding generic edit/delete", () => {
    render(
      <EmployeeDetailPanel
        employee={employee}
        canManage={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    const toggle = screen.getByRole("checkbox", { name: "다음 배정 가능 여부" });
    expect(toggle).toBeChecked();
    expect(screen.queryByRole("button", { name: "직원 작업 메뉴 열기" })).not.toBeInTheDocument();
    expect(screen.queryByText("수정")).not.toBeInTheDocument();
    expect(screen.queryByText("삭제")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(mockOpenStatusMutate).toHaveBeenCalledWith(
      { id: 7, openToNextWork: false },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(toggle).not.toBeChecked();

    act(() => {
      mockOpenStatusMutate.mock.calls[0][1].onError(new Error("failed"));
    });
    expect(toggle).toBeChecked();
  });

  it("keeps manager edit/delete actions alongside the availability toggle", () => {
    render(
      <EmployeeDetailPanel
        employee={employee}
        canManage
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "직원 작업 메뉴 열기" })).toBeInTheDocument();
    expect(screen.getByText("수정")).toBeInTheDocument();
    expect(screen.getByText("삭제")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "다음 배정 가능 여부" })).toBeChecked();
  });
});
