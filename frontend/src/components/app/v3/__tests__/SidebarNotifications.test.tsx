import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useClientAlerts } from "@/hooks/useClientAlerts";
import { useMarkAsRead, useNotifications } from "@/hooks/usePushNotification";

import { SidebarNotifications } from "../SidebarNotifications";

jest.mock("@/hooks/useClientAlerts", () => ({
  useClientAlerts: jest.fn(),
}));

jest.mock("@/hooks/usePushNotification", () => ({
  useMarkAsRead: jest.fn(),
  useNotifications: jest.fn(),
}));

jest.mock("@/components/app/v3/useScrollActivity", () => ({
  useScrollActivity: () => ({
    isScrollActive: false,
    handleScroll: jest.fn(),
  }),
}));

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockedUseClientAlerts = jest.mocked(useClientAlerts);
const mockedUseMarkAsRead = jest.mocked(useMarkAsRead);
const mockedUseNotifications = jest.mocked(useNotifications);

describe("SidebarNotifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseMarkAsRead.mockReturnValue({ mutate: jest.fn() } as unknown as ReturnType<typeof useMarkAsRead>);
  });

  it("renders notification skeletons instead of the empty state while queries are loading", () => {
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: true } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({ data: [], isLoading: true } as unknown as ReturnType<typeof useNotifications>);

    const { rerender } = render(<SidebarNotifications />);
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));

    expect(screen.queryByText("새 알림이 없습니다")).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-component="desktop_chrome_sidebar_notifications-modal_item"]')).toHaveLength(6);

    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({
      data: [{
        id: 1,
        title: "계약 알림",
        body: "확인이 필요합니다.",
        data: {},
        sentAt: "2026-08-02T00:00:00.000Z",
        readAt: null,
        isRead: false,
      }],
      isLoading: false,
    } as unknown as ReturnType<typeof useNotifications>);
    rerender(<SidebarNotifications />);

    expect(screen.getByText("계약 알림")).toBeInTheDocument();
  });

  it("navigates a failed document job notification to its recovery link", () => {
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({
      data: [{
        id: 3,
        title: "계약서 자동 전송 실패",
        body: "계약서를 자동으로 보내지 못했어요.",
        data: { type: "eformsign_document_job_failed", url: "/contracts?recoverJobId=j1" },
        sentAt: "2026-08-19T00:00:00.000Z",
        readAt: null,
        isRead: false,
      }],
      isLoading: false,
    } as unknown as ReturnType<typeof useNotifications>);

    render(<SidebarNotifications />);
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));
    fireEvent.click(screen.getByText("계약서 자동 전송 실패"));

    expect(mockPush).toHaveBeenCalledWith("/contracts?recoverJobId=j1");
  });

  it("keeps read and unread notification frames gray without selection semantics", () => {
    const markAsRead = jest.fn();
    mockedUseMarkAsRead.mockReturnValue({ mutate: markAsRead } as unknown as ReturnType<typeof useMarkAsRead>);
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({
      data: [false, true].map((isRead, index) => ({
        id: index + 10, title: isRead ? "읽은 알림" : "새 알림", body: "내용",
        data: { url: "/messages" }, sentAt: "2026-08-19T00:00:00.000Z",
        readAt: isRead ? "2026-08-19T01:00:00.000Z" : null, isRead,
      })), isLoading: false,
    } as unknown as ReturnType<typeof useNotifications>);
    render(<SidebarNotifications />);
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));
    const unread = screen.getByText("새 알림").closest('[data-slot="animated-slot-list-item"]')!;
    const read = screen.getByText("읽은 알림").closest('[data-slot="animated-slot-list-item"]')!;
    for (const item of [unread, read]) {
      expect(item).toHaveClass("border-2", "border-v3-selectable-border", "hover:border-v3-selectable-border");
      expect(item).not.toHaveClass("border-v3-primary");
      expect(item.className).not.toMatch(/!border|!bg/);
      expect(item).not.toHaveAttribute("aria-pressed");
      expect(item).not.toHaveAttribute("data-selected", "true");
    }
    expect(unread).toHaveTextContent("읽지 않음");
    expect(read).not.toHaveTextContent("읽지 않음");
    fireEvent.keyDown(unread, { key: " " });
    expect(markAsRead).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/messages");
  });

  it("preserves unread-only read mutations, no-link behavior, counts and action navigation through the real shell", () => {
    const mutate = jest.fn();
    mockedUseMarkAsRead.mockReturnValue({ mutate } as unknown as ReturnType<typeof useMarkAsRead>);
    mockedUseClientAlerts.mockReturnValue({ data: [{ id: 9, name: "서명 고객", reason: "서명 필요", priority: 2, createdAt: "2026-08-19" }], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({ data: [
      { id: 4, title: "읽은 알림", body: "내용", data: {}, sentAt: "2026-08-21", isRead: true },
      { id: 5, title: "안 읽은 알림", body: "내용", data: {}, sentAt: "2026-08-20", isRead: false },
    ], isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    render(<SidebarNotifications />);
    expect(document.querySelector('[data-component="desktop_chrome_sidebar_notifications_trigger_badge"]')).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));
    expect(screen.getByRole("dialog", { name: "알림" })).toHaveAttribute("data-source-component", "AnchoredNotificationModalShell");
    fireEvent.click(screen.getByText("읽은 알림"));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("안 읽은 알림"));
    expect(mutate).toHaveBeenCalledWith(5);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("서명 고객"));
    expect(mockPush).toHaveBeenCalledWith("/dashboard?clientId=9");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps an empty error result read-only without inventing a notification", () => {
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false, isError: true } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({ data: [], isLoading: false, isError: true } as unknown as ReturnType<typeof useNotifications>);
    render(<SidebarNotifications />);
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));
    expect(screen.getByText("새 알림이 없습니다")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each(["Escape", "backdrop"] as const)("closes through the real shell on %s and returns focus to its trigger", async (dismissal) => {
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useNotifications>);
    render(<SidebarNotifications />);
    const trigger = screen.getByRole("button", { name: "알림 열기" });

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole("button", { name: "알림 닫기" })).toHaveFocus());
    if (dismissal === "Escape") {
      fireEvent.keyDown(screen.getByRole("dialog", { name: "알림" }), { key: "Escape" });
    } else {
      const backdrop = document.querySelector('[data-slot="anchored-notification-backdrop"]');
      if (!backdrop) throw new Error("Notification backdrop is missing");
      fireEvent.pointerDown(backdrop, { button: 0 });
    }
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("wraps a specific notification body without overlapping its time label", () => {
    mockedUseClientAlerts.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useClientAlerts>);
    mockedUseNotifications.mockReturnValue({
      data: [{
        id: 2,
        title: "메시지 전송 실패",
        body: "강하은 관리사님에게 보낸 제공기록지 메시지 전송이 실패했습니다.",
        data: { type: "daily-summary-item", url: "/messages" },
        sentAt: "2026-08-19T00:00:00.000Z",
        readAt: null,
        isRead: false,
      }],
      isLoading: false,
    } as unknown as ReturnType<typeof useNotifications>);

    render(<SidebarNotifications />);
    fireEvent.click(screen.getByRole("button", { name: "알림 열기" }));

    const item = document.querySelector<HTMLElement>(
      '[data-component="desktop_chrome_sidebar_notifications-modal_item"]',
    );
    const subtitle = document.querySelector<HTMLElement>(
      '[data-component="desktop_chrome_sidebar_notifications-modal_item-content-subtitle"] > span',
    );
    const time = document.querySelector<HTMLElement>(
      '[data-component="desktop_chrome_sidebar_notifications-modal_item_time"]',
    );

    expect(item).toHaveClass("h-auto", "min-h-[calc(94px*var(--glint-ui-scale,1))]");
    expect(subtitle).toHaveClass("whitespace-normal", "break-words");
    expect(subtitle).not.toHaveClass("truncate");
    expect(time).not.toHaveClass("absolute");
  });
});
