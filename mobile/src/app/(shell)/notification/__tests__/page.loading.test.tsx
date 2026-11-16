import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";

import NotificationPage from "../page";
import { settingsApi } from "@/services/api";

let mockEmail = "qa@example.test";
jest.mock("@/lib/notification-config", () => ({ NOTIFICATION_EMAIL_ENABLED: true, PWA_NOTIFICATIONS_ENABLED: false }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ data: { id: "qa", email: mockEmail, role: "owner" } }) }));
jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({ isSupported: true, isSubscribed: false, permission: "default", isLoading: false }),
}));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn(() => new Promise(() => {})) } }));
jest.mock("@/services/api", () => ({ settingsApi: { getNotificationPreferences: jest.fn(), updateNotificationPreferences: jest.fn() } }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><NotificationPage /></QueryClientProvider>);
}

describe("notification route loading presentation", () => {
  beforeEach(() => {
    mockEmail = "qa@example.test";
    jest.mocked(settingsApi.getNotificationPreferences).mockReturnValue(new Promise(() => {}));
  });

  it.each([
    ["", "현재 계정 이메일을 불러오는 중입니다"],
    ["qa@example.test", "이메일 알림 설정을 불러오는 중입니다"],
  ])("announces the pending email state for %s without visible copy", (email, label) => {
    mockEmail = email;
    renderPage();
    const status = screen.getByRole("status", { name: label });
    expect(status.tagName).toBe("SPAN");
    expect(status.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.getByText(label)).toHaveClass("sr-only");
  });

  it("disables the broadcast action and hides its idle label during submission", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "발송" }));
    const button = await screen.findByRole("button", { name: "전송 중" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-loading", "");
    const idle = button.querySelector('[data-slot="button-idle"]');
    expect(idle).toHaveAttribute("aria-hidden", "true");
    expect(idle).toHaveClass("contents", "invisible");
    expect(idle).toHaveTextContent("발송");
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
  });
});
