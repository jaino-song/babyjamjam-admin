import { act, fireEvent, render, screen } from "@testing-library/react";

import { NotificationBell } from "../NotificationBell";

let mockSubscribed = true;
let mockHasData = false;
let mockLoading = true;
const mockSubscribe = jest.fn();

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../FilteredClientsDialog", () => ({ FilteredClientsDialog: () => null }));
jest.mock("@/lib/notification-config", () => ({ PWA_NOTIFICATIONS_ENABLED: true }));
jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({ isSupported: true, isSubscribed: mockSubscribed, permission: "granted", subscribe: mockSubscribe }),
  useUnreadCount: () => ({ data: 0 }),
  useNotifications: () => ({ data: mockHasData ? [] : undefined, isLoading: mockLoading }),
  useMarkAsRead: () => ({ mutate: jest.fn() }),
  useMarkAllAsRead: () => ({ mutate: jest.fn() }),
}));

beforeEach(() => {
  mockSubscribed = true;
  mockHasData = false;
  mockLoading = true;
});

it.each([false, true])("labels notification list loading with cached data=%s", (hasData) => {
  mockHasData = hasData;
  const { rerender } = render(<NotificationBell data-component="mobile_shell_header_notification-bell" />);
  fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));
  const status = screen.getByRole("status", { name: "알림을 불러오는 중" });
  expect(status).toHaveAttribute("data-component", "mobile_shell_header_notification-bell_list-loading");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(status.querySelector(".sr-only")).toHaveTextContent("알림을 불러오는 중");
  mockHasData = true;
  mockLoading = false;
  rerender(<NotificationBell data-component="mobile_shell_header_notification-bell" />);
  expect(screen.queryByRole("status", { name: "알림을 불러오는 중" })).not.toBeInTheDocument();
  expect(screen.getByText("알림이 없습니다")).toBeInTheDocument();
});

it("names and disables the bell while subscribing, then restores its idle name", async () => {
  mockSubscribed = false;
  let resolveSubscribe!: (success: boolean) => void;
  mockSubscribe.mockReturnValue(new Promise<boolean>((resolve) => { resolveSubscribe = resolve; }));
  render(<NotificationBell />);
  fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));
  const busy = screen.getByRole("button", { name: "알림 상태를 확인하는 중" });
  expect(busy).toBeDisabled();
  expect(busy).toHaveAttribute("aria-busy", "true");
  expect(busy.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(busy.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  await act(async () => resolveSubscribe(true));
  expect(screen.getByRole("button", { name: "알림 열기" })).toBeEnabled();
});
