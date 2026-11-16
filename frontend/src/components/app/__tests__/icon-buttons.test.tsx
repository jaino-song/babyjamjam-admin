import { fireEvent, render, screen } from "@testing-library/react";

import { NotificationPermissionPrompt } from "../notification-permission-prompt";
import { SidebarNotifications } from "../v3/SidebarNotifications";

jest.mock("@/lib/notification-config", () => ({ PWA_NOTIFICATIONS_ENABLED: true }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/hooks/useClientAlerts", () => ({ useClientAlerts: () => ({ data: [], isLoading: false }) }));
jest.mock("@/hooks/usePushNotification", () => ({
  useNotifications: () => ({ data: [], isLoading: false }),
  useMarkAsRead: () => ({ mutate: jest.fn() }),
}));

function expectIconSize(button: HTMLElement) {
  expect(button).toHaveAttribute("data-size", "icon");
  expect(button).toHaveClass(
    "h-[calc(32px*var(--glint-ui-scale,1))]", "w-[calc(32px*var(--glint-ui-scale,1))]",
    "relative", "after:absolute", "after:content-['']",
    "after:h-[calc(44px*var(--glint-ui-scale,1))]", "after:w-[calc(44px*var(--glint-ui-scale,1))]",
  );
  expect(button).not.toHaveClass("h-8");
  expect(button).not.toHaveClass("w-8");
  expect(button.querySelector("svg")).toHaveClass("h-4", "w-4");
}

it("gives the permission prompt close button scaled 32/44 sizing and still dismisses it", async () => {
  const originalNotification = window.Notification;
  Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default" } });
  try {
    render(<NotificationPermissionPrompt />);
    const close = await screen.findByRole("button", { name: "알림 권한 안내 닫기" });
    expectIconSize(close);
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  } finally {
    window.localStorage.clear();
    Object.defineProperty(window, "Notification", { configurable: true, value: originalNotification });
  }
});

it("gives the notification modal close button scaled 32/44 sizing and still dismisses it", () => {
  render(<SidebarNotifications />);
  fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));
  const close = screen.getByRole("button", { name: "알림 닫기" });
  expectIconSize(close);
  fireEvent.click(close);
  expect(screen.queryByRole("button", { name: "알림 닫기" })).not.toBeInTheDocument();
});
