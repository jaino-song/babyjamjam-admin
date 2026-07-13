import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { settingsApi } from "@/services/api";
import NotificationPage from "../page";

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: {
      id: "user-1",
      email: "owner@example.com",
      role: "owner",
    },
  }),
}));

jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({
    isSupported: true,
    isSubscribed: false,
    permission: "default",
    isLoading: false,
    error: null,
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/components/ui/toaster", () => ({
  Toaster: () => <div data-component="toaster" />,
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => null,
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn().mockResolvedValue({ data: [] }),
    post: jest.fn().mockResolvedValue({ data: { sent: 0, failed: 0 } }),
  },
}));

jest.mock("@/services/api", () => ({
  settingsApi: {
    getAlimtalkProvider: jest.fn(),
    updateAlimtalkProvider: jest.fn(),
  },
}));

const mockGetAlimtalkProvider = settingsApi.getAlimtalkProvider as jest.Mock;
const mockUpdateAlimtalkProvider = settingsApi.updateAlimtalkProvider as jest.Mock;

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationPage />
    </QueryClientProvider>,
  );
}

describe("NotificationPage", () => {
  beforeEach(() => {
    mockGetAlimtalkProvider.mockResolvedValue({ provider: "aligo_alimtalk" });
    mockUpdateAlimtalkProvider.mockResolvedValue({ provider: "none" });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders existing notification settings in the compact list card UI", async () => {
    const { container } = renderPage();

    const page = container.querySelector('[data-component="notification-settings"]');
    expect(page).toBeInTheDocument();
    expect(page).toHaveClass("alimtalk-page");

    expect(screen.getByText("알림 설정")).toBeInTheDocument();
    expect(screen.getByText("수신 채널")).toBeInTheDocument();
    expect(screen.getByText("알림톡 서비스")).toBeInTheDocument();
    expect(screen.getByText("관리자")).toBeInTheDocument();

    expect(await screen.findByText("알리고 (Aligo)")).toBeInTheDocument();

    const rows = container.querySelectorAll('[data-component="notification-settings-row"]');
    expect(rows.length).toBeGreaterThanOrEqual(5);

    expect(within(rows[0] as HTMLElement).getByText("앱 알림")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("이메일 알림")).toBeInTheDocument();
    expect(screen.getByLabelText("앱 알림 설정")).toBeInTheDocument();
    expect(screen.getByLabelText("이메일 알림 설정")).toBeInTheDocument();

    expect(screen.getByText("사용 안함")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "발송" })).toBeInTheDocument();
  });

  it("selects an alimtalk provider when the provider row is clicked", async () => {
    renderPage();

    const noneTitle = await screen.findByText("사용 안함");
    fireEvent.click(noneTitle);

    await waitFor(() => {
      expect(mockUpdateAlimtalkProvider.mock.calls[0]?.[0]).toBe("none");
    });
  });
});
