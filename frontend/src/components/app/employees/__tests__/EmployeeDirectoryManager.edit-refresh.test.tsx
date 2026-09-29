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
  EmployeeFormPanel: ({
    onSuccess,
    onDirtyChange,
    onBeforeClose,
    onClose,
    renderLayout,
  }: {
    onSuccess?: (employee: Employee) => void;
    onDirtyChange?: (dirty: boolean) => void;
    onBeforeClose?: () => boolean;
    onClose: () => void;
    renderLayout?: (slots: { content: ReactNode; footer: ReactNode }) => ReactNode;
  }) => {
    const requestClose = () => {
      if (onBeforeClose?.() === false) return;
      onClose();
    };

    return renderLayout?.({
      content: (
        <>
          <label>
            초안 이름
            <input aria-label="초안 이름" onChange={() => onDirtyChange?.(true)} />
          </label>
          <button type="button" onClick={requestClose}>패널 닫기</button>
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
        </>
      ),
      footer: null,
    }) ?? null;
  },
}));

jest.mock("@/components/app/ui/TwoButtonModal", () => ({
  TwoButtonModal: ({
    open,
    title,
    approvalLabel,
    onApprove,
    onOpenChange,
  }: {
    open: boolean;
    title: string;
    approvalLabel: string;
    onApprove: () => void;
    onOpenChange: (open: boolean) => void;
  }) => open ? (
    <div role="dialog">
      <h2>{title}</h2>
      <button type="button" onClick={() => onOpenChange(false)}>취소</button>
      <button type="button" onClick={onApprove}>{approvalLabel}</button>
    </div>
  ) : null,
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
  ListPanel: ({
    children,
    tabs,
    activeTab,
    onTabChange,
    headerActions,
  }: {
    children: ReactNode;
    tabs?: Array<{ label: string; value: string }>;
    activeTab?: string;
    onTabChange?: (value: string) => void;
    headerActions?: ReactNode;
  }) => (
    <section>
      {headerActions}
      <div role="tablist">
        {tabs?.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            onClick={() => onTabChange?.(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </section>
  ),
  DetailPanel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SplitLayout: ({ children, hasSelection, onBack }: {
    children: ReactNode;
    hasSelection?: boolean;
    onBack?: () => void;
  }) => (
    <div>
      {hasSelection ? (
        <button type="button" onClick={onBack}>직원 목록으로 돌아가기</button>
      ) : null}
      {children}
    </div>
  ),
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

  it("clears the selected detail only after changing the availability tab", () => {
    render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "홍길동" }));
    expect(screen.getByTestId("employee-detail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "전체" }));
    expect(screen.getByTestId("employee-detail")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "배정 불가" }));
    expect(screen.queryByTestId("employee-detail")).not.toBeInTheDocument();
    expect(screen.getByText("직원을 선택하면 상세 정보가 표시됩니다")).toBeInTheDocument();
  });

  it("keeps a dirty create draft on cancel and discards it with the tab change", () => {
    render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "직원 추가" }));
    const draftInput = screen.getByRole("textbox", { name: "초안 이름" });
    fireEvent.change(draftInput, { target: { value: "임시 직원" } });

    fireEvent.click(screen.getByRole("tab", { name: "배정 불가" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("작성 중인 직원 정보를 버리시겠습니까?");

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("textbox", { name: "초안 이름" })).toHaveValue("임시 직원");
    expect(screen.getByRole("tab", { name: "전체" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "배정 불가" }));
    fireEvent.click(screen.getByRole("button", { name: "버리기" }));

    expect(screen.queryByRole("textbox", { name: "초안 이름" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "배정 불가" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("직원을 선택하면 상세 정보가 표시됩니다")).toBeInTheDocument();
  });

  it("keeps a dirty create draft when 직원 추가 is clicked again", () => {
    render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "직원 추가" }));
    const draftInput = screen.getByRole("textbox", { name: "초안 이름" });
    fireEvent.change(draftInput, { target: { value: "임시 직원" } });

    fireEvent.click(screen.getByRole("button", { name: "직원 추가" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "초안 이름" })).toHaveValue("임시 직원");
  });

  it("guards a dirty create draft before selecting another employee", () => {
    render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "직원 추가" }));
    const draftInput = screen.getByRole("textbox", { name: "초안 이름" });
    fireEvent.change(draftInput, { target: { value: "임시 직원" } });
    fireEvent.click(screen.getByRole("button", { name: "홍길동" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("작성 중인 직원 정보를 버리시겠습니까?");
    expect(screen.getByRole("textbox", { name: "초안 이름" })).toHaveValue("임시 직원");

    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("textbox", { name: "초안 이름" })).toHaveValue("임시 직원");
    expect(screen.queryByTestId("employee-detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "홍길동" }));
    fireEvent.click(screen.getByRole("button", { name: "버리기" }));

    expect(screen.queryByRole("textbox", { name: "초안 이름" })).not.toBeInTheDocument();
    expect(screen.getByTestId("employee-detail")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "홍길동" })).toBeInTheDocument();
  });

  it("guards a dirty create draft before compact back", () => {
    render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "직원 추가" }));
    const draftInput = screen.getByRole("textbox", { name: "초안 이름" });
    fireEvent.change(draftInput, { target: { value: "임시 직원" } });
    fireEvent.click(screen.getByRole("button", { name: "직원 목록으로 돌아가기" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("작성 중인 직원 정보를 버리시겠습니까?");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("textbox", { name: "초안 이름" })).toHaveValue("임시 직원");

    fireEvent.click(screen.getByRole("button", { name: "직원 목록으로 돌아가기" }));
    fireEvent.click(screen.getByRole("button", { name: "버리기" }));

    expect(screen.queryByRole("textbox", { name: "초안 이름" })).not.toBeInTheDocument();
    expect(screen.getByText("직원을 선택하면 상세 정보가 표시됩니다")).toBeInTheDocument();
  });

  it("guards a dirty create draft before the panel close action", () => {
    render(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "직원 추가" }));
    const draftInput = screen.getByRole("textbox", { name: "초안 이름" });
    fireEvent.change(draftInput, { target: { value: "임시 직원" } });
    fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("작성 중인 직원 정보를 버리시겠습니까?");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.getByRole("textbox", { name: "초안 이름" })).toHaveValue("임시 직원");

    fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "버리기" }));

    expect(screen.queryByRole("textbox", { name: "초안 이름" })).not.toBeInTheDocument();
    expect(screen.getByText("직원을 선택하면 상세 정보가 표시됩니다")).toBeInTheDocument();
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

    const conflictingEmployee: Employee = {
      ...toggledStaleEmployee,
      name: "외부 선행 변경",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [conflictingEmployee],
        allEmployees: [conflictingEmployee],
        filteredCount: 1,
        isError: false,
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "외부 선행 변경" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-phone")).toHaveTextContent("01087654321");

    const baselineAfterConflict: Employee = {
      ...employee,
      openToNextWork: false,
      status: "unavailable",
    };
    mockedUseInfiniteEmployees.mockReturnValue(
      makeQueryResult({
        employees: [baselineAfterConflict],
        allEmployees: [baselineAfterConflict],
        filteredCount: 1,
      }),
    );
    rerender(
      <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />,
    );
    expect(within(detail).getByRole("heading", { name: "홍길동" })).toBeInTheDocument();
    expect(within(detail).getByTestId("employee-detail-phone")).toHaveTextContent("01087654321");

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
