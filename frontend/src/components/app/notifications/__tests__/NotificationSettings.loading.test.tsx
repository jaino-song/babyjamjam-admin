import { act, fireEvent, render, screen } from "@testing-library/react";

import { NotificationSettings } from "../NotificationSettings";

let mockIsLoading = false;
let mockIsSubscribed = false;
const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock("@/lib/notification-config", () => ({ PWA_NOTIFICATIONS_ENABLED: true }));
jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({
    isSupported: true, isSubscribed: mockIsSubscribed, permission: "granted",
    isLoading: mockIsLoading, error: null, subscribe: mockSubscribe, unsubscribe: mockUnsubscribe,
  }),
}));

beforeEach(() => {
  mockIsLoading = false;
  mockIsSubscribed = false;
  jest.clearAllMocks();
});

it("names the initial subscription read as loading settings", () => {
  mockIsLoading = true;
  render(<NotificationSettings />);
  expect(screen.getByRole("status", { name: "알림 설정을 불러오는 중" })).toBeInTheDocument();
  expect(screen.queryByRole("status", { name: "알림 설정을 변경하는 중" })).not.toBeInTheDocument();
});

it.each([false, true])("names a pending change as changing settings (subscribed=%s)", async (subscribed) => {
  mockIsSubscribed = subscribed;
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const change = subscribed ? mockUnsubscribe : mockSubscribe;
  change.mockReturnValue(pending);
  const { rerender } = render(<NotificationSettings />);

  fireEvent.click(screen.getByRole("switch", { name: "푸시 알림 설정" }));
  mockIsLoading = true;
  rerender(<NotificationSettings />);
  expect(change).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status", { name: "알림 설정을 변경하는 중" })).toBeInTheDocument();
  expect(screen.queryByRole("status", { name: "알림 설정을 불러오는 중" })).not.toBeInTheDocument();

  await act(async () => { mockIsLoading = false; finish(); await pending; });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "푸시 알림 설정" })).toBeEnabled();
});
