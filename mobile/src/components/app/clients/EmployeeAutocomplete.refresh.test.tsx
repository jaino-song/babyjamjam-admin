import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import type { Employee } from "@/hooks/useEmployees";

import { EmployeeAutocomplete } from "./EmployeeAutocomplete";

const employeeOne: Employee = {
  id: 1,
  name: "하나",
  workArea: ["인천 서구"],
  phone: "01011112222",
  grade: "관리사",
  openToNextWork: true,
  registeredDate: null,
  status: "available",
};
const employeeTwo: Employee = {
  id: 2,
  name: "둘",
  workArea: ["인천 남동구"],
  phone: "01022223333",
  grade: "관리사",
  openToNextWork: true,
  registeredDate: null,
  status: "available",
};
const employeeThree: Employee = {
  id: 3,
  name: "셋",
  workArea: ["인천 부평구"],
  phone: "01033334444",
  grade: "관리사",
  openToNextWork: true,
  registeredDate: null,
  status: "available",
};

let mockEmployees = [employeeOne, employeeTwo];
let mockServerEmployees = mockEmployees;
const mockRefetch = jest.fn(async () => {
  mockEmployees = mockServerEmployees;
  return { data: mockEmployees };
});

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({
    data: mockEmployees,
    isLoading: false,
    refetch: mockRefetch,
  }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/lib/i18n/translations", () => ({
  t: (_locale: string, key: string) => key,
}));

jest.mock("@/stores/employee-dialog-store", () => ({
  useEmployeeDialogStore: (selector: (state: { setPrefillName: jest.Mock }) => unknown) =>
    selector({ setPrefillName: jest.fn() }),
}));

function AssignmentFields() {
  const [primaryId, setPrimaryId] = useState<number | null>(employeeOne.id);
  const [secondaryId, setSecondaryId] = useState<number | null>(employeeTwo.id);

  return (
    <>
      <EmployeeAutocomplete
        data-component="mobile_clients_new_primary"
        value={primaryId}
        onChange={(id) => setPrimaryId(id)}
        label="주 담당"
        excludeIds={secondaryId === null ? [] : [secondaryId]}
        refreshOnMount
      />
      <EmployeeAutocomplete
        data-component="mobile_clients_new_secondary"
        value={secondaryId}
        onChange={(id) => setSecondaryId(id)}
        label="보조 담당"
        excludeIds={primaryId === null ? [] : [primaryId]}
        refreshOnMount
      />
    </>
  );
}

describe("EmployeeAutocomplete refresh behavior", () => {
  beforeEach(() => {
    mockEmployees = [employeeOne, employeeTwo];
    mockServerEmployees = mockEmployees;
    mockRefetch.mockClear();
  });

  it("refreshes the shared list when reopened and preserves selected/excluded IDs", () => {
    const { rerender } = render(<AssignmentFields />);

    const primaryInput = within(screen.getByTestId("mobile_clients_new_primary")).getByRole("textbox");
    const secondaryInput = within(screen.getByTestId("mobile_clients_new_secondary")).getByRole("textbox");
    fireEvent.click(primaryInput);

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    const primaryDropdown = screen.getByTestId("mobile_clients_new_primary_dropdown");
    expect(within(primaryDropdown).getByText("하나")).toBeInTheDocument();
    expect(within(primaryDropdown).queryByText("둘")).not.toBeInTheDocument();

    fireEvent.keyDown(primaryInput, { key: "Escape" });
    mockServerEmployees = [employeeOne, employeeTwo, employeeThree];
    rerender(<AssignmentFields />);
    fireEvent.click(primaryInput);
    rerender(<AssignmentFields />);
    fireEvent.change(primaryInput, { target: { value: "" } });

    expect(mockRefetch).toHaveBeenCalledTimes(2);
    const refreshedPrimaryDropdown = screen.getByTestId("mobile_clients_new_primary_dropdown");
    expect(within(refreshedPrimaryDropdown).getByText("셋")).toBeInTheDocument();
    expect(within(refreshedPrimaryDropdown).getByText("하나").closest('[data-component$="option-1"]')?.querySelector("svg"))
      .toHaveClass("opacity-100");

    fireEvent.keyDown(primaryInput, { key: "Escape" });
    fireEvent.click(secondaryInput);
    fireEvent.change(secondaryInput, { target: { value: "" } });
    const secondaryDropdown = screen.getByTestId("mobile_clients_new_secondary_dropdown");
    expect(within(secondaryDropdown).getByText("둘")).toBeInTheDocument();
    expect(within(secondaryDropdown).getByText("셋")).toBeInTheDocument();
    expect(within(secondaryDropdown).queryByText("하나")).not.toBeInTheDocument();
  });
});
