import { renderHook } from "@testing-library/react";

import { useEmployees } from "@/hooks/useEmployees";
import { useInfiniteEmployees } from "@/hooks/useInfiniteEmployees";

jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: jest.fn(),
}));

const mockedUseEmployees = jest.mocked(useEmployees);

describe("useInfiniteEmployees query state forwarding", () => {
  it("preserves query failure and refetch state for the page", () => {
    const refetch = jest.fn();

    mockedUseEmployees.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useEmployees>);

    const { result } = renderHook(() => useInfiniteEmployees());

    expect(result.current.isError).toBe(true);
    expect(result.current.refetch).toBe(refetch);
  });

  it("keeps search totals independent from the availability tab", () => {
    const employees = [
      {
        id: 1,
        name: "홍길동",
        workArea: ["gangnam"],
        phone: "01012345678",
        grade: "A",
        openToNextWork: true,
        registeredDate: null,
        status: "unavailable",
      },
      {
        id: 2,
        name: "홍길순",
        workArea: ["gangnam"],
        phone: "01087654321",
        grade: "B",
        openToNextWork: false,
        registeredDate: null,
        status: "working",
      },
    ];

    mockedUseEmployees.mockReturnValue({
      data: employees,
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useEmployees>);

    const { result } = renderHook(() =>
      useInfiniteEmployees({ filter: "active", search: "홍" }),
    );

    expect(result.current.searchMatchedEmployees).toHaveLength(2);
    expect(result.current.searchMatchedCount).toBe(2);
    expect(result.current.filteredCount).toBe(1);
    expect(result.current.employees.map((employee) => employee.id)).toEqual([1]);
  });
});
