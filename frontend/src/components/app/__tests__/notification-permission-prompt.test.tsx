import { fireEvent, render, screen } from "@testing-library/react";
import { NotificationPermissionPrompt } from "../notification-permission-prompt";

describe("NotificationPermissionPrompt", () => {
  const originalNotification = window.Notification;

  afterEach(() => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
  });

  it("clears the desktop quick-action rail and exposes a named dialog", async () => {
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "default",
        requestPermission: jest.fn(),
      },
    });

    render(<NotificationPermissionPrompt />);

    const prompt = await screen.findByRole("dialog", { name: "알림을 허용하시겠습니까?" });
    expect(prompt).toHaveClass(
      "md:right-[calc(24px+72px*var(--glint-ui-scale,1))]",
    );

    fireEvent.click(screen.getByRole("button", { name: "알림 권한 안내 닫기" }));
    expect(prompt).not.toBeInTheDocument();
  });
});
