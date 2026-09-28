import { act, fireEvent, render, screen } from "@testing-library/react";

import type { Employee } from "@/hooks/useEmployees";

import { EmployeeDetailModal } from "../EmployeeDetailModal";

const mockUseInitialUser = jest.fn();
const mockOpenStatusMutate = jest.fn();

jest.mock("@/hooks/useEmployees", () => ({
  useToggleEmployeeOpenStatus: () => ({
    isPending: false,
    mutate: mockOpenStatusMutate,
  }),
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => mockUseInitialUser(),
}));

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

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

jest.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

jest.mock("@/components/app/ui/info-row", () => ({
  InfoRow: ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

const employeeWithoutRegisteredDate = {
  id: 7,
  name: "알 수 없는 직원",
  workArea: ["서울"],
  phone: "821012345678",
  grade: "베스트",
  openToNextWork: true,
  registeredDate: null,
  status: "available",
} as unknown as Employee;

describe("EmployeeDetailModal registration date", () => {
  beforeEach(() => {
    mockUseInitialUser.mockReturnValue({ role: "admin", branchRole: "user" });
    mockOpenStatusMutate.mockReset();
  });

  it("renders a localized unknown value instead of a fabricated date", () => {
    render(
      <EmployeeDetailModal
        open
        onClose={jest.fn()}
        employee={employeeWithoutRegisteredDate}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByText("알 수 없음")).toBeInTheDocument();
  });

  it("formats a country-code prefixed stored phone with the shared formatter", () => {
    render(
      <EmployeeDetailModal
        open
        onClose={jest.fn()}
        employee={employeeWithoutRegisteredDate}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByText("010-1234-5678")).toBeInTheDocument();
  });

  it("lets staff toggle availability through open-status while hiding generic edit/delete", () => {
    render(
      <EmployeeDetailModal
        open
        onClose={jest.fn()}
        employee={employeeWithoutRegisteredDate}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    const toggle = screen.getByRole("checkbox", { name: "다음 배정 가능 여부" });
    expect(toggle).toBeChecked();
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

  it("keeps generic edit/delete actions for a branch manager alongside availability", () => {
    mockUseInitialUser.mockReturnValue({ role: "user", branchRole: "manager" });

    render(
      <EmployeeDetailModal
        open
        onClose={jest.fn()}
        employee={employeeWithoutRegisteredDate}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    expect(screen.getByText("수정")).toBeInTheDocument();
    expect(screen.getByText("삭제")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "다음 배정 가능 여부" })).toBeChecked();
  });
});
