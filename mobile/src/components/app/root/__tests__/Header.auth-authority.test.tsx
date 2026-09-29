import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AUTH_USER_QUERY_KEY } from "@/hooks/useGetAuthUser";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import { Header } from "../Header";
import { api } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  api: { get: jest.fn() },
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("../../nav-bar/nav-bar", () => ({
  NavBar: () => <div data-testid="nav-bar" />,
}));

jest.mock("../../notifications", () => ({
  NotificationBell: () => <div data-testid="notification-bell" />,
}));

const mockApiGet = api.get as jest.Mock;

const oldBranchManager = {
  id: "user-1",
  name: "테스트 사용자",
  role: "user",
  branchRole: "manager",
  branchName: "이전 지점",
};

const newBranchStaff = {
  id: "user-1",
  name: "테스트 사용자",
  role: "user",
  branchRole: "user",
  branchName: "새 지점",
};

describe("mobile Header auth authority", () => {
  beforeEach(() => {
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ data: newBranchStaff });
  });

  it("does not reseed a cleared auth cache from the previous layout snapshot", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30 * 60 * 1000 } },
    });
    queryClient.setQueryData(AUTH_USER_QUERY_KEY, oldBranchManager);

    const view = render(
      <QueryClientProvider client={queryClient}>
        <Header initialUser={oldBranchManager} />
      </QueryClientProvider>,
    );

    expect(queryClient.getQueryData(AUTH_USER_QUERY_KEY)).toEqual(oldBranchManager);

    await act(async () => {
      await resetAuthorityState(queryClient, { waitForCancellation: false });
    });

    expect(queryClient.getQueryData(AUTH_USER_QUERY_KEY)).toBeUndefined();

    // Keep the old layout snapshot mounted while the new branch's /auth/me
    // response resolves. The Header must fetch live authority instead of
    // writing that stale snapshot back into the shared cache.
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Header initialUser={oldBranchManager} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(queryClient.getQueryData(AUTH_USER_QUERY_KEY)).toEqual(newBranchStaff);
    });
    expect(mockApiGet).toHaveBeenCalledWith("/auth/me");
    expect(screen.getByText("테사")).toBeInTheDocument();
  });
});
