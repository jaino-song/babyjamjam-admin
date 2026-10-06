import { render, screen } from "@testing-library/react";

import HolidaysPage from "../page";

interface MockAuthUser {
  id: string;
  name: string;
  role?: string;
  branchRole?: string | null;
  branchId?: string | null;
  branchName?: string | null;
}

let mockAuth: { data: MockAuthUser | null | undefined; isPending: boolean; isFetching: boolean };

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => mockAuth,
}));

jest.mock("@/components/app/holidays/HolidaySettingsSection", () => ({
  HolidaySettingsSection: ({ branchId, branchName }: { branchId: string; branchName?: string | null }) => (
    <div data-testid="holiday-settings-section">{`${branchId}|${branchName ?? ""}`}</div>
  ),
}));

const MANAGER: MockAuthUser = {
  id: "u1",
  name: "관리자",
  role: "staff",
  branchRole: "manager",
  branchId: "branch-1",
  branchName: "인천 남동지점",
};

describe("HolidaysPage", () => {
  beforeEach(() => {
    mockAuth = { data: MANAGER, isPending: false, isFetching: false };
  });

  it("shows a spinner and no section while the auth user is loading", () => {
    mockAuth = { data: undefined, isPending: true, isFetching: true };
    render(<HolidaysPage />);

    expect(document.querySelector("[data-slot='spinner']")).not.toBeNull();
    expect(screen.queryByTestId("holiday-settings-section")).not.toBeInTheDocument();
  });

  it("renders the section for the manager's active branch", () => {
    render(<HolidaysPage />);

    expect(screen.getByTestId("holiday-settings-section")).toHaveTextContent("branch-1|인천 남동지점");
  });

  it("keeps the section mounted during a background refetch", () => {
    mockAuth = { data: MANAGER, isPending: false, isFetching: true };
    render(<HolidaysPage />);

    expect(screen.getByTestId("holiday-settings-section")).toBeInTheDocument();
  });

  it("asks a manager without an active branch to pick one", () => {
    mockAuth = { data: { ...MANAGER, branchId: null, branchName: null }, isPending: false, isFetching: false };
    render(<HolidaysPage />);

    expect(screen.getByText("공휴일은 지점별로 관리돼요. 상단에서 지점을 먼저 선택해 주세요.")).toBeInTheDocument();
    expect(screen.queryByTestId("holiday-settings-section")).not.toBeInTheDocument();
  });

  it("tells a non-manager that the screen is for branch managers, without rendering the section", () => {
    mockAuth = {
      data: { ...MANAGER, branchRole: "member" },
      isPending: false,
      isFetching: false,
    };
    render(<HolidaysPage />);

    expect(screen.getByText("공휴일 설정은 지점 관리자만 사용할 수 있어요.")).toBeInTheDocument();
    expect(screen.queryByTestId("holiday-settings-section")).not.toBeInTheDocument();
  });

  it("treats an owner as a manager", () => {
    mockAuth = {
      data: { ...MANAGER, role: "owner", branchRole: null },
      isPending: false,
      isFetching: false,
    };
    render(<HolidaysPage />);

    expect(screen.getByTestId("holiday-settings-section")).toBeInTheDocument();
  });
});
