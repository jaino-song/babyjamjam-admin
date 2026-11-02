import { render, screen, within } from "@testing-library/react";

import AllMenuPage from "../page";

let mockAuthUser: { id: string; name: string; role?: string; branchRole?: string | null } | null = null;
let mockAuthFetching = false;

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: mockAuthUser,
    isPending: false,
    isLoading: false,
    isFetching: mockAuthFetching,
    isError: false,
  }),
}));

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: [], isLoading: false, isError: false, error: null }),
}));
jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: false, isError: false, error: null }),
}));
jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false, isError: false, error: null }),
}));
jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({ isLoading: false, isSubscribed: false }),
}));
jest.mock("@/hooks/use-consultation-inquiries", () => ({
  useConsultationInquiries: () => ({ data: { total: 0 }, isLoading: false, isError: false, error: null }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/all",
}));
jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => null,
}));

function settingsGroup(): HTMLElement {
  const title = screen.getByText("설정", { selector: ".menu-group-title" });
  return title.closest(".menu-group") as HTMLElement;
}

describe("AllMenuPage 설정 group", () => {
  beforeEach(() => {
    mockAuthUser = null;
    mockAuthFetching = false;
  });

  it("shows 공휴일 after 알림 설정 for a branch manager, linking to /holidays", () => {
    mockAuthUser = { id: "u1", name: "관리자", role: "staff", branchRole: "manager" };
    render(<AllMenuPage />);

    const group = settingsGroup();
    const link = within(group).getByRole("link", { name: /공휴일/ });
    expect(link).toHaveAttribute("href", "/holidays");

    const labels = within(group)
      .getAllByRole("link")
      .map((row) => row.textContent ?? "");
    const notificationIndex = labels.findIndex((text) => text.includes("알림 설정"));
    const holidaysIndex = labels.findIndex((text) => text.includes("공휴일"));
    expect(notificationIndex).toBeGreaterThanOrEqual(0);
    expect(holidaysIndex).toBe(notificationIndex + 1);
  });

  it("shows 공휴일 for a branch admin and an owner too", () => {
    mockAuthUser = { id: "u2", name: "지점장", role: "staff", branchRole: "admin" };
    const { unmount } = render(<AllMenuPage />);
    expect(within(settingsGroup()).getByText("공휴일")).toBeInTheDocument();
    unmount();

    mockAuthUser = { id: "u3", name: "오너", role: "owner", branchRole: null };
    render(<AllMenuPage />);
    expect(within(settingsGroup()).getByText("공휴일")).toBeInTheDocument();
  });

  it("hides 공휴일 for a branch member", () => {
    mockAuthUser = { id: "u4", name: "직원", role: "staff", branchRole: "member" };
    render(<AllMenuPage />);

    expect(within(settingsGroup()).getByText("알림 설정")).toBeInTheDocument();
    expect(screen.queryByText("공휴일")).not.toBeInTheDocument();
  });

  it("hides 공휴일 while the auth user is still being refetched", () => {
    mockAuthUser = { id: "u1", name: "관리자", role: "staff", branchRole: "manager" };
    mockAuthFetching = true;
    render(<AllMenuPage />);

    expect(screen.queryByText("공휴일")).not.toBeInTheDocument();
  });
});
