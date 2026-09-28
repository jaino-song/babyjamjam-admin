import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { EmployeeDirectoryManager } from "@/components/app/employees/EmployeeDirectoryManager";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";
import type { Employee } from "@/hooks/useEmployees";

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => ({ role: "user", branchRole: "manager" }),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { role: "user", branchRole: "manager" },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
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
      <p data-testid="employee-detail-availability">
        {employee.openToNextWork ? "available" : "unavailable"}
      </p>
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
              openToNextWork: false,
              status: "unavailable",
            });
          }
          onClose();
        }}
      >
        직원 저장
      </button>
    );
  },
  EmployeeFormPanel: ({ onSuccess }: { onSuccess?: (employee: Employee) => void }) => (
    <button
      type="button"
      onClick={() => onSuccess?.({
        id: 2,
        name: "신규 직원",
        workArea: ["gangnam"],
        phone: "01022223333",
        grade: "A",
        openToNextWork: false,
        registeredDate: "2026-08-27T00:00:00.000Z",
        status: "unavailable",
      })}
    >
      직원 저장
    </button>
  ),
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
  ListPanel: ({ children, headerActions }: { children: ReactNode; headerActions?: ReactNode }) => (
    <section>{headerActions}{children}</section>
  ),
  SplitLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  StatsBar: ({ items }: { items: Array<{ label: string; value: number }> }) => (
    <div data-testid="employee-stats">
      {items.map((item) => (
        <span key={item.label} data-testid={`employee-stat-${item.label}`}>{item.value}</span>
      ))}
    </div>
  ),
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

function makeQueryResult(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
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

  it("keeps saved availability through a stale or failed refetch before live reconciliation", () => {
    const { rerender } = render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "홍길동" }));
    fireEvent.click(screen.getByRole("button", { name: "직원 수정" }));
    fireEvent.click(screen.getByRole("button", { name: "직원 저장" }));

    const detail = screen.getByTestId("employee-detail");
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("unavailable");

    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        isError: true,
        // The refetch failed, so allEmployees still contains the pre-save row.
        employees: [employee],
        allEmployees: [employee],
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("unavailable");

    const toggledStaleEmployee: Employee = {
      ...employee,
      openToNextWork: false,
      status: "unavailable",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        isError: true,
        // The availability cache patch changed only the derived status fields;
        // the confirmed form fields still need to survive this stale row.
        employees: [toggledStaleEmployee],
        allEmployees: [toggledStaleEmployee],
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "김철수" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-phone")).toHaveTextContent("01087654321");
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("unavailable");

    const savedEmployee: Employee = {
      ...employee,
      name: "김철수",
      phone: "01087654321",
      openToNextWork: false,
      status: "unavailable",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [],
        allEmployees: [savedEmployee],
        filteredCount: 0,
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "김철수" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("unavailable");

    const revertedEmployee: Employee = {
      ...savedEmployee,
      name: employee.name,
      phone: employee.phone,
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [revertedEmployee],
        allEmployees: [revertedEmployee],
        filteredCount: 1,
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "홍길동" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-phone")).toHaveTextContent("01012345678");

    const externalEmployee: Employee = {
      ...savedEmployee,
      name: "외부 변경",
      openToNextWork: true,
      status: "available",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [externalEmployee],
        allEmployees: [externalEmployee],
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "외부 변경" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("available");
  });

  it("releases a created form snapshot once the new row appears in the live list", () => {
    const { rerender } = render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "직원 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "직원 저장" }));

    const detail = screen.getByTestId("employee-detail");
    expect(within(detail).getByRole("heading", { name: "신규 직원" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("unavailable");

    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        isError: true,
        // The create response succeeded, but the failed refetch has not
        // returned the new employee yet.
        employees: [employee],
        allEmployees: [employee],
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "신규 직원" })).toBeInTheDocument();

    const createdEmployee: Employee = {
      id: 2,
      name: "신규 직원",
      workArea: ["gangnam"],
      phone: "01022223333",
      grade: "A",
      openToNextWork: false,
      registeredDate: "2026-08-27T00:00:00.000Z",
      status: "unavailable",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [createdEmployee],
        allEmployees: [createdEmployee],
        filteredCount: 1,
        isError: false,
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "신규 직원" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("unavailable");

    const externalEmployee: Employee = {
      ...createdEmployee,
      name: "외부 신규 변경",
      openToNextWork: true,
      status: "available",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [externalEmployee],
        allEmployees: [externalEmployee],
        filteredCount: 1,
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "외부 신규 변경" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("available");
  });

  it("reflects a cache-patched status in stats while a refetch is failing", () => {
    const { rerender } = render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    expect(screen.getByTestId("employee-stat-배정 가능")).toHaveTextContent("1");
    expect(screen.getByTestId("employee-stat-배정 불가")).toHaveTextContent("0");

    const patchedEmployee: Employee = {
      ...employee,
      openToNextWork: false,
      status: "unavailable",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [],
        allEmployees: [patchedEmployee],
        filteredCount: 0,
        isError: true,
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    expect(screen.getByTestId("employee-stat-배정 가능")).toHaveTextContent("0");
    expect(screen.getByTestId("employee-stat-배정 불가")).toHaveTextContent("1");
  });

  it("refreshes the selected detail from the unfiltered list when a filtered row changes", () => {
    const { rerender } = render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "홍길동" }));

    const refreshedEmployee: Employee = {
      ...employee,
      name: "김철수",
      phone: "01087654321",
      openToNextWork: false,
      status: "unavailable",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [],
        allEmployees: [refreshedEmployee],
        filteredCount: 0,
      }),
    );

    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    const detail = screen.getByTestId("employee-detail");
    expect(within(detail).getByRole("heading", { name: "김철수" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-phone")).toHaveTextContent("01087654321");
    expect(within(detail).getByTestId("employee-detail-availability")).toHaveTextContent("unavailable");
  });
});
