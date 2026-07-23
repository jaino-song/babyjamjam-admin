import { fireEvent, render, screen } from "@testing-library/react";

import { ContractsServiceRecordsSection } from "../ContractsServiceRecordsSection";

const mockUseClientServiceRecords = jest.fn();

jest.mock("@/features/service-records/hooks/use-service-records", () => ({
  useClientServiceRecords: (clientId: number | null) => mockUseClientServiceRecords(clientId),
}));

jest.mock("@/components/app/clients/ClientAutocomplete", () => ({
  ClientAutocomplete: ({
    onChange,
  }: {
    onChange: (
      clientId: number | null,
      client: { id: number; name: string; phone: string; address: string } | null,
    ) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange(7, {
          id: 7,
          name: "송진호",
          phone: "01066211878",
          address: "경기도 고양시",
        })
      }
    >
      테스트 고객 선택
    </button>
  ),
}));

jest.mock("@/components/app/clients/ClientServiceRecordsTab", () => ({
  ClientServiceRecordsTab: ({ clientId }: { clientId: number | null }) => (
    <div>제공기록지 상세 {clientId}</div>
  ),
}));

describe("ContractsServiceRecordsSection", () => {
  beforeEach(() => {
    mockUseClientServiceRecords.mockReturnValue({
      data: { assignments: [] },
      isLoading: false,
      isError: false,
    });
  });

  it("loads the selected client's service records in the detail panel", () => {
    render(<ContractsServiceRecordsSection />);

    expect(screen.getByText("선택한 고객이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("고객을 선택하면 제공기록지가 표시됩니다")).toBeInTheDocument();
    expect(mockUseClientServiceRecords).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "테스트 고객 선택" }));

    expect(mockUseClientServiceRecords).toHaveBeenLastCalledWith(7);
    expect(screen.getByRole("heading", { name: "송진호" })).toBeInTheDocument();
    expect(screen.getAllByText("010-6621-1878 · 경기도 고양시")).toHaveLength(2);
    expect(screen.getByText("제공기록지 상세 7")).toBeInTheDocument();
  });
});
