import { fireEvent, render, screen } from "@testing-library/react";

import type { Employee } from "@/hooks/useEmployees";
import { ContractEmployeeSelector } from "../ContractEmployeeSelector";

const mockEmployee: Employee = {
  id: 31,
  name: "신규 제공인력",
  phone: "010-1111-2222",
  workArea: ["남동구"],
  grade: "1등급",
  openToNextWork: true,
  registeredDate: "2026-07-10",
  status: "available",
};

jest.mock("@/components/app/clients/EmployeeAutocomplete", () => ({
  EmployeeAutocomplete: ({
    allowManualEntry,
    label,
    onManualEntry,
    placeholder,
  }: {
    allowManualEntry?: boolean;
    label: string;
    onManualEntry?: () => void;
    placeholder?: string;
  }) => (
    <div>
      <span>{label}</span>
      <span>{placeholder}</span>
      {allowManualEntry ? (
        <button type="button" onClick={onManualEntry}>
          새 제공인력 등록
        </button>
      ) : null}
    </div>
  ),
}));

jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({
  EmployeeFormDialog: ({
    onClose,
    onSuccess,
    open,
  }: {
    onClose: () => void;
    onSuccess?: (employee: Employee) => void;
    open: boolean;
  }) =>
    open ? (
      <div role="dialog" aria-label="새 제공인력 등록">
        <button type="button" onClick={() => onSuccess?.(mockEmployee)}>
          등록 완료
        </button>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    ) : null,
}));

describe("ContractEmployeeSelector", () => {
  it("reuses the client registration selector UI while preserving contract copy", () => {
    render(
      <ContractEmployeeSelector
        value={null}
        onChange={jest.fn()}
        label="제공인력 1 선택"
        placeholder="이름으로 검색..."
      />,
    );

    expect(screen.getByText("제공인력 1 선택")).toBeInTheDocument();
    expect(screen.getByText("이름으로 검색...")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "새 제공인력 등록" }),
    ).toBeInTheDocument();
  });

  it("selects a provider created from the shared registration dialog", () => {
    const onChange = jest.fn();
    render(
      <ContractEmployeeSelector
        value={null}
        onChange={onChange}
        label="제공인력 1 선택"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "새 제공인력 등록" }));
    fireEvent.click(screen.getByRole("button", { name: "등록 완료" }));

    expect(onChange).toHaveBeenCalledWith(mockEmployee.id, mockEmployee);
  });

  it("closes the shared registration dialog without changing selection", () => {
    const onChange = jest.fn();
    render(
      <ContractEmployeeSelector
        value={null}
        onChange={onChange}
        label="제공인력 2 선택"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "새 제공인력 등록" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
