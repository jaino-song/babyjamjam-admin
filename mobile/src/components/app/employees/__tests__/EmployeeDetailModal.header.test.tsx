import { fireEvent, render, screen, within } from "@testing-library/react";

import type { Employee } from "@/hooks/useEmployees";

import { EmployeeDetailModal } from "../EmployeeDetailModal";

jest.mock("@/hooks/useEmployees", () => ({
  useToggleEmployeeOpenStatus: () => ({ isPending: false, mutate: jest.fn() }),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { role: "admin", branchRole: "user" },
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

const employee = {
  id: 7,
  name: "QA-제공인력",
  workArea: ["서울"],
  phone: "",
  grade: "베스트",
  openToNextWork: true,
  registeredDate: null,
  status: "available",
} as Employee;

describe("EmployeeDetailModal header", () => {
  it("centers the title with equal side padding and keeps close reachable", () => {
    const onClose = jest.fn();
    render(
      <EmployeeDetailModal
        open
        onClose={onClose}
        employee={employee}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    const title = screen.getByRole("heading", { name: employee.name });
    expect(title).toHaveClass("text-center");
    expect(title).not.toHaveClass("text-left");
    const header = title.parentElement!;
    expect(header).toHaveClass("px-8");
    expect(header).not.toHaveClass("pr-8");
    expect(screen.getByRole("dialog", { name: employee.name })).toHaveAttribute(
      "data-component",
      "mobile_employees_table_detail-modal_content",
    );
    const close = within(header).getByRole("button", { name: "Close" });
    expect(close).toHaveClass("absolute", "right-4", "top-4");
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
