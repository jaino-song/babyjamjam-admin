import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { EmployeeDirectoryManager } from "@/components/app/employees/EmployeeDirectoryManager";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import type { Employee } from "@/hooks/useEmployees";

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/hooks/useInfiniteEmployees", () => ({
  useInfiniteEmployees: jest.fn(),
}));

jest.mock("@/hooks/useEmployees", () => ({
  useDeleteEmployee: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
}));

jest.mock("@/components/app/employees/EmployeeDetailPanel", () => ({
  EmployeeDetailPanel: ({
    employee,
    onEdit,
  }: {
    employee: Employee;
    onEdit: (employee: Employee) => void;
  }) => (
    <section data-testid="employee-detail">
      <h2>{employee.name}</h2>
      <p data-testid="employee-detail-phone">{employee.phone}</p>
      <button type="button" onClick={() => onEdit(employee)}>
        직원 수정
      </button>
    </section>
  ),
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: ({
    open,
    employee,
    onSuccess,
    onClose,
  }: {
    open: boolean;
    employee?: Employee | null;
    onSuccess?: (employee: Employee) => void;
    onClose: () => void;
  }) => {
    if (!open) return null;

    return (
      <button
        type="button"
        onClick={() => {
          if (employee) {
            onSuccess?.({
              ...employee,
              name: "김철수",
              phone: "01087654321",
            });
          }
          onClose();
        }}
      >
        직원 저장
      </button>
    );
  },
  EmployeeFormPanel: () => null,
}));

jest.mock("@/components/app/ui/TwoButtonModal", () => ({
  TwoButtonModal: () => null,
}));

jest.mock("@/components/app/ui/NotificationOneButtonModal", () => ({
  NotificationOneButtonModal: () => null,
}));

jest.mock("@/components/app/ui/status-badge", () => ({
  StatusPill: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

jest.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => <span />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("@/components/ui/alert", () => ({
  Alert: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  AlertDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertTitle: ({ children }: { children: ReactNode }) => <h3>{children}</h3>,
}));

jest.mock("@/components/app/v3", () => ({
  AnimatedSlotList: ({
    items,
    isLoading,
    render,
    onSlotClick,
  }: {
    items: Employee[];
    isLoading: boolean;
    render: (props: { item: Employee; isLoading: boolean }) => ReactNode;
    onSlotClick?: (item: Employee) => void;
  }) => (
    <div>
      {!isLoading
        ? items.map((item) => (
            <button key={item.id} type="button" onClick={() => onSlotClick?.(item)}>
              {render({ item, isLoading: false })}
            </button>
          ))
        : null}
    </div>
  ),
  AnimatedSlotListItemContent: ({ title }: { title: string }) => <span>{title}</span>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  HeaderActionButton: ({ label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) => (
    <button type="button" {...props}>{label}</button>
  ),
  ListEmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  ListPanel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SplitLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StatsBar: () => null,
}));

const mockedUseInfiniteEmployees = jest.mocked(useInfiniteEmployees);

const employee: Employee = {
  id: 1,
  name: "홍길동",
  workArea: ["gangnam"],
  phone: "01012345678",
  grade: "A",
  openToNextWork: true,
  registeredDate: "2026-08-27T00:00:00.000Z",
  status: "available",
};

function makeQueryResult() {
  return {
    employees: [employee],
    allEmployees: [employee],
    filteredCount: 1,
    isLoading: false,
    isError: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useInfiniteEmployees>;
}

describe("EmployeeDirectoryManager edit refresh", () => {
  beforeEach(() => {
    mockedUseInfiniteEmployees.mockReset();
    mockedUseInfiniteEmployees.mockReturnValue(makeQueryResult());
  });

  it("updates the selected detail after an edit without reselecting or reloading", () => {
    render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "홍길동" }));
    const detail = screen.getByTestId("employee-detail");
    expect(within(detail).getByRole("heading", { name: "홍길동" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-phone")).toHaveTextContent("01012345678");

    fireEvent.click(within(detail).getByRole("button", { name: "직원 수정" }));
    fireEvent.click(screen.getByRole("button", { name: "직원 저장" }));

    expect(within(detail).getByRole("heading", { name: "김철수" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-phone")).toHaveTextContent("01087654321");
  });
});
