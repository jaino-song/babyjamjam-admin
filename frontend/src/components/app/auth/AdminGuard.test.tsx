import { render, screen } from "@testing-library/react";
import { AdminGuard } from "./AdminGuard";

const mockUseGetAuthUser = jest.fn();
let mockPathname = "/admin/system";

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => mockUseGetAuthUser(),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("./AccessDenied", () => ({
  AccessDenied: () => <div>access-denied</div>,
}));

function authState(overrides: Record<string, unknown>) {
  return { data: undefined, isPending: false, isLoading: false, isFetching: false, isError: false, ...overrides };
}

describe("AdminGuard", () => {
  beforeEach(() => {
    mockPathname = "/admin/system";
  });

  it("keeps the guarded page mounted during a background refetch of a known user", () => {
    mockUseGetAuthUser.mockReturnValue(authState({ data: { role: "owner" }, isFetching: true }));
    render(<AdminGuard><div>admin-content</div></AdminGuard>);
    expect(screen.getByText("admin-content")).toBeInTheDocument();
  });

  it("keeps the feedback route mounted during a background refetch of a branch manager", () => {
    mockPathname = "/admin/feedback";
    mockUseGetAuthUser.mockReturnValue(
      authState({ data: { role: "user", branchRole: "manager" }, isFetching: true }),
    );
    render(<AdminGuard><div>feedback-content</div></AdminGuard>);
    expect(screen.getByText("feedback-content")).toBeInTheDocument();
  });

  it("shows the loading state, not the page, while no user is known yet", () => {
    mockUseGetAuthUser.mockReturnValue(authState({ isFetching: true }));
    render(<AdminGuard><div>admin-content</div></AdminGuard>);
    expect(screen.queryByText("admin-content")).not.toBeInTheDocument();
    expect(screen.queryByText("access-denied")).not.toBeInTheDocument();
  });

  it("denies a plain branch user, refetching or not", () => {
    mockUseGetAuthUser.mockReturnValue(
      authState({ data: { role: "user", branchRole: "user" }, isFetching: true }),
    );
    render(<AdminGuard><div>admin-content</div></AdminGuard>);
    expect(screen.queryByText("admin-content")).not.toBeInTheDocument();
    expect(screen.getByText("access-denied")).toBeInTheDocument();
  });

  it("denies when the user query errored", () => {
    mockUseGetAuthUser.mockReturnValue(authState({ data: { role: "owner" }, isError: true }));
    render(<AdminGuard><div>admin-content</div></AdminGuard>);
    expect(screen.getByText("access-denied")).toBeInTheDocument();
  });
});
