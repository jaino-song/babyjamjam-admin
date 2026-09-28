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
  EmployeeFormPanel: ({
    onDirtyChange,
    onBeforeClose,
    onClose,
    renderLayout,
  }: {
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
});
