import { fireEvent, render, screen } from "@testing-library/react";

import { EmployeeAutocomplete } from "../EmployeeAutocomplete";
import type { Employee } from "@/hooks/useEmployees";

let mockEmployees: Employee[] = [];
const mockSetPrefillName = jest.fn();

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({
    data: mockEmployees,
    isLoading: false,
  }),
}));

jest.mock("@/stores/employee-dialog-store", () => ({
  useEmployeeDialogStore: (selector: (state: { setPrefillName: typeof mockSetPrefillName }) => unknown) =>
    selector({ setPrefillName: mockSetPrefillName }),
}));

const employee: Employee = {
  id: 1,
  name: "김제공",
  phone: "010-1111-2222",
  workArea: ["서울"],
  grade: "A",
  openToNextWork: true,
  registeredDate: "2026-01-01",
  status: "available",
};

describe("EmployeeAutocomplete", () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmployees = [employee];
  });

  it("notifies parent while typing a manual provider name", async () => {
    const onChange = jest.fn();
    const onManualInputChange = jest.fn();

    render(
      <EmployeeAutocomplete
        value={null}
        onChange={onChange}
        label="제공인력 1 성함"
        allowManualInput
        manualValue=""
        onManualInputChange={onManualInputChange}
      />
    );

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(await screen.findByPlaceholderText("이름으로 검색..."), {
      target: { value: "홍길동" },
    });

    expect(onManualInputChange).toHaveBeenLastCalledWith("홍길동");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows a manually typed provider name in the trigger", () => {
    render(
      <EmployeeAutocomplete
        value={null}
        onChange={jest.fn()}
        label="제공인력 1 성함"
        allowManualInput
        manualValue="홍길동"
      />
    );

    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("홍길동");
    expect(trigger).toHaveClass("h-[38px]");
    expect(trigger).toHaveClass("rounded-[13px]");
    expect(trigger).toHaveClass("border-[1.35px]");
  });

  it("keeps manual typing disabled when an existing employee is selected", async () => {
    const onManualInputChange = jest.fn();

    render(
      <EmployeeAutocomplete
        value={employee.id}
        onChange={jest.fn()}
        label="제공인력 1 성함"
        allowManualInput
        manualValue=""
        onManualInputChange={onManualInputChange}
      />
    );

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.change(await screen.findByPlaceholderText("이름으로 검색..."), {
      target: { value: "새 이름" },
    });

    expect(onManualInputChange).not.toHaveBeenCalled();
  });

  it("clears the selected provider from the overlay clear button", () => {
    const onChange = jest.fn();
    const onManualInputChange = jest.fn();

    render(
      <EmployeeAutocomplete
        value={employee.id}
        onChange={onChange}
        label="제공인력 1 성함"
        onManualInputChange={onManualInputChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "제공인력 선택 해제" }));

    expect(onChange).toHaveBeenCalledWith(null, null);
    expect(onManualInputChange).toHaveBeenCalledWith("");
  });
});
