import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import NotificationPage from "../page";
import { settingsApi } from "@/services/api";

jest.mock("@/lib/notification-config", () => ({
  NOTIFICATION_EMAIL_ENABLED: true,
  PWA_NOTIFICATIONS_ENABLED: false,
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({
    data: { id: "user-1", email: "owner@example.com", role: "staff" },
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
    getNotificationPreferences: jest.fn(),
    updateNotificationPreferences: jest.fn(),
  },
}));

const mockedSettingsApi = jest.mocked(settingsApi);

const PREFERENCES_KEY = ["settings", "notification-preferences", "user-1"] as const;
const NO_DATA_TITLE = "이메일 알림 설정을 불러오지 못했습니다";
const CACHED_TITLE = "최신 정보를 불러오지 못했습니다";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <NotificationPage />
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

describe("NotificationPage email preference load failures", () => {
  beforeEach(() => {
    // mockClear leaves unconsumed once-queues behind; reset so one test can never leak into the next.
    mockedSettingsApi.getNotificationPreferences.mockReset();
    mockedSettingsApi.updateNotificationPreferences.mockReset();
  });

  it("shows a failure alert with retry and keeps the switch disabled when the load failed with no data", async () => {
    mockedSettingsApi.getNotificationPreferences.mockRejectedValueOnce(new Error("load failed"));

    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(NO_DATA_TITLE);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();

    const emailSwitch = screen.getByRole("switch", { name: "이메일 알림 설정" });
    expect(emailSwitch).toBeDisabled();
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("owner@example.com로 주요 알림을 받습니다.")).not.toBeInTheDocument();
    expect(mockedSettingsApi.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("retry refetches the preferences and a successful load enables the switch with the loaded value", async () => {
    mockedSettingsApi.getNotificationPreferences
      .mockRejectedValueOnce(new Error("load failed"))
      .mockResolvedValueOnce({ emailNotificationsEnabled: true });

    renderPage();

    await screen.findByRole("alert");
    expect(mockedSettingsApi.getNotificationPreferences).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    const emailSwitch = screen.getByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));
    expect(emailSwitch).not.toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockedSettingsApi.getNotificationPreferences).toHaveBeenCalledTimes(2);
  });

  it("shows no alert and an operable switch after a successful load", async () => {
    mockedSettingsApi.getNotificationPreferences.mockResolvedValueOnce({ emailNotificationsEnabled: false });

    renderPage();

    const emailSwitch = screen.getByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => expect(emailSwitch).not.toBeDisabled());
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("owner@example.com로 주요 알림을 받습니다.")).toBeInTheDocument();
  });

  it("keeps the cached value, an operable switch and one inline notice when a refetch failed", async () => {
    mockedSettingsApi.getNotificationPreferences.mockResolvedValueOnce({ emailNotificationsEnabled: true });

    const { queryClient } = renderPage();

    const emailSwitch = screen.getByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));

    mockedSettingsApi.getNotificationPreferences.mockRejectedValueOnce(new Error("refetch failed"));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: PREFERENCES_KEY });
    });

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(CACHED_TITLE);
    expect(alerts[0]).not.toHaveTextContent(NO_DATA_TITLE);
    expect(emailSwitch).toHaveAttribute("aria-checked", "true");
    expect(emailSwitch).not.toBeDisabled();
  });

  it("disables the inline notice retry while the retry is in flight and refetches on click", async () => {
    mockedSettingsApi.getNotificationPreferences.mockResolvedValueOnce({ emailNotificationsEnabled: true });

    const { queryClient } = renderPage();

    const emailSwitch = screen.getByRole("switch", { name: "이메일 알림 설정" });
    await waitFor(() => expect(emailSwitch).toHaveAttribute("aria-checked", "true"));

    mockedSettingsApi.getNotificationPreferences.mockRejectedValueOnce(new Error("refetch failed"));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: PREFERENCES_KEY });
    });
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "다시 시도" })).not.toBeDisabled();

    let resolveRetry: (value: { emailNotificationsEnabled: boolean }) => void = () => undefined;
    mockedSettingsApi.getNotificationPreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRetry = resolve;
      }),
    );
    const callsBeforeRetry = mockedSettingsApi.getNotificationPreferences.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled());
    expect(mockedSettingsApi.getNotificationPreferences.mock.calls.length).toBe(callsBeforeRetry + 1);

    await act(async () => {
      resolveRetry({ emailNotificationsEnabled: false });
    });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(emailSwitch).toHaveAttribute("aria-checked", "false");
  });
});
