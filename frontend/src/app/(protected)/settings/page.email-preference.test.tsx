import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";

import SettingsPage from "./page";

jest.mock("@/lib/notification-config", () => ({
  ...jest.requireActual("@/lib/notification-config"),
  NOTIFICATION_EMAIL_ENABLED: true,
}));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"), useQuery: jest.fn(),
}));
jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: () => ({ data: { name: "직원", role: "user" }, isLoading: false }),
}));
jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({ isSupported: false, isLoading: false }),
}));
jest.mock("@/services/api", () => ({ settingsApi: {
  getNotificationPreferences: jest.fn(), updateNotificationPreferences: jest.fn(),
} }));
jest.mock("@/features/auth/settings/kakao-link-result-modal", () => ({ KakaoLinkResultModal: () => null }));
jest.mock("@/components/app/call-ingest-tokens/CallIngestTokenSection", () => ({ CallIngestTokenSection: () => null }));
jest.mock("@/components/app/holidays/HolidaySettingsSection", () => ({ HolidaySettingsSection: () => null }));
jest.mock("@/components/app/notifications/SendNotificationSection", () => ({ SendNotificationSection: () => null }));

const refetch = jest.fn();
const query = {
  data: undefined as { emailNotificationsEnabled: boolean } | undefined,
  isLoading: false, isPending: false, isPaused: false, isError: false,
  isFetching: false, status: "success", fetchStatus: "idle", refetch,
};
function renderPage(overrides: Partial<typeof query>) {
  jest.mocked(useQuery).mockReturnValue({ ...query, ...overrides } as unknown as ReturnType<typeof useQuery>);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>);
  fireEvent.click(screen.getAllByRole("button", { name: "알림" })[0]);
  return view;
}

describe("SettingsPage email preference load", () => {
  beforeEach(() => refetch.mockClear());

  it("fails without inventing an enabled preference and retries the query", () => {
    renderPage({ isError: true, status: "error" });
    const toggle = screen.getByRole("switch", { name: "이메일 알림" });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("이메일 알림 설정을 불러오지 못했습니다");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { isLoading: true, isPending: true, status: "pending", isFetching: true, fetchStatus: "fetching" },
    { isLoading: false, isPending: true, isPaused: true, isError: false, isFetching: false, status: "pending", fetchStatus: "paused" },
  ])("keeps an unknown preference disabled without ON or an alert: %j", (state) => {
    renderPage(state);
    expect(screen.getByRole("switch", { name: "이메일 알림" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "이메일 알림" })).not.toBeChecked();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([true, false])("preserves the loaded preference %s", (enabled) => {
    renderPage({ data: { emailNotificationsEnabled: enabled } });
    const toggle = screen.getByRole("switch", { name: "이메일 알림" });
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute("aria-checked", String(enabled));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([true, false])("keeps cached %s usable with exactly one retry notice", (enabled) => {
    renderPage({ data: { emailNotificationsEnabled: enabled }, isError: true, status: "error" });
    expect(screen.getByRole("switch", { name: "이메일 알림" })).toBeEnabled();
    expect(screen.getByRole("switch", { name: "이메일 알림" })).toHaveAttribute("aria-checked", String(enabled));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("disables retry only during a cached-data refetch", () => {
    renderPage({ data: { emailNotificationsEnabled: true }, isError: true, status: "error", isFetching: true, fetchStatus: "fetching" });
    expect(within(screen.getByRole("alert")).getByRole("button")).toBeDisabled();
    expect(screen.getByRole("switch", { name: "이메일 알림" })).toBeEnabled();
  });

  it("does not change cached data during a paused refetch", () => {
    renderPage({ data: { emailNotificationsEnabled: true }, isPaused: true, fetchStatus: "paused" });
    expect(screen.getByRole("switch", { name: "이메일 알림" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "이메일 알림" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
