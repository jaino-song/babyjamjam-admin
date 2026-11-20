import { act, fireEvent, render, screen } from "@testing-library/react";

import { NotificationPermissionPrompt } from "../notification-permission-prompt";

jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
jest.mock("@/lib/notification-config", () => ({ PWA_NOTIFICATIONS_ENABLED: true }));

function expectIconTarget(button: HTMLElement): void {
  expect(button).toHaveClass("relative", "h-8", "w-8", "after:absolute", "after:-inset-1.5", "after:content-['']");
}

it("sizes the permission prompt close control while preserving dismissal", () => {
  const original = window.Notification;
  jest.useFakeTimers();
  Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "default" } });
  try {
    render(<NotificationPermissionPrompt />);
    act(() => jest.runOnlyPendingTimers());
    const close = screen.getByRole("button", { name: "닫기" });
    expectIconTarget(close);
    fireEvent.click(close);
    expect(screen.queryByRole("button", { name: "닫기" })).not.toBeInTheDocument();
  } finally {
    window.localStorage.clear();
    Object.defineProperty(window, "Notification", { configurable: true, value: original });
    jest.useRealTimers();
  }
});
