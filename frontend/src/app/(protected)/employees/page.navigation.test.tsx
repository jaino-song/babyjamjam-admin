import { fireEvent, render, screen } from "@testing-library/react";
import EmployeesPage from "./page";

const mockPush = jest.fn();
let mockQuery = new URLSearchParams();

jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush }),
    useSearchParams: () => mockQuery,
}));
jest.mock("@/components/app/v3", () => ({
    PageSection: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
    SectionNav: ({ items, activeId, onSelect, ariaLabel }: {
        items: { id: string; label: string }[]; activeId: string;
        onSelect: (id: string) => void; ariaLabel: string;
    }) => <nav aria-label={ariaLabel}>{items.map(item => <button key={item.id} aria-pressed={activeId === item.id} onClick={() => onSelect(item.id)}>{item.label}</button>)}</nav>,
}));
jest.mock("@/components/app/employees/EmployeeDirectoryManager", () => ({
    EmployeeDirectoryManager: () => <div>직원 관리 내용</div>,
}));
jest.mock("@/components/app/employees/EmployeeScheduleManager", () => ({
    EmployeeScheduleManager: () => <div>서비스 일정 내용</div>,
}));

describe("employee section navigation", () => {
    beforeEach(() => { mockQuery = new URLSearchParams(); mockPush.mockClear(); });

    it("opens schedules within employees and unmounts the previous section", () => {
        const { rerender } = render(<EmployeesPage />);
        expect(screen.getByText("직원 관리 내용")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "서비스 일정" }));
        expect(mockPush).toHaveBeenCalledWith("/employees?section=schedule", { scroll: false });
        mockQuery = new URLSearchParams("section=schedule");
        rerender(<EmployeesPage />);
        expect(screen.queryByText("직원 관리 내용")).not.toBeInTheDocument();
        expect(screen.getByText("서비스 일정 내용")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "서비스 일정" })).toHaveAttribute("aria-pressed", "true");
        fireEvent.click(screen.getByRole("button", { name: "직원 관리" }));
        expect(mockPush).toHaveBeenLastCalledWith("/employees", { scroll: false });
    });

    it("restores schedule deep links and falls back for unknown sections", () => {
        mockQuery = new URLSearchParams("section=schedule");
        const { rerender } = render(<EmployeesPage />);
        expect(screen.getByText("서비스 일정 내용")).toBeInTheDocument();
        mockQuery = new URLSearchParams("section=unknown");
        rerender(<EmployeesPage />);
        expect(screen.getByText("직원 관리 내용")).toBeInTheDocument();
        expect(screen.queryByText("서비스 일정 내용")).not.toBeInTheDocument();
    });
});
