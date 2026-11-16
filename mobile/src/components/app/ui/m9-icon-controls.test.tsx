import { act, fireEvent, render, screen } from "@testing-library/react";

import { NotificationPermissionPrompt } from "../notification-permission-prompt";
import { CodeBlock } from "../chat/CodeBlock";

jest.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
jest.mock("@/lib/notification-config", () => ({ PWA_NOTIFICATIONS_ENABLED: true }));
jest.mock("react-syntax-highlighter", () => ({ Prism: () => null }));
jest.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({ oneDark: {} }));

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

it("keeps code copying on a 32/44 button", async () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  jest.useFakeTimers();
  try {
    render(<CodeBlock data-component="mobile_chat_assistant_code">QA-example</CodeBlock>);
    const copy = screen.getByRole("button");
    expectIconTarget(copy);
    expect(copy).not.toHaveClass("h-6", "w-6");
    await act(async () => fireEvent.click(copy));
    expect(writeText).toHaveBeenCalledWith("QA-example");
    act(() => jest.runOnlyPendingTimers());
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
    jest.useRealTimers();
  }
});
