"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, Clock3, Headset, X } from "lucide-react";

import { useClientAlerts } from "@/hooks/useClientAlerts";
import { useMarkAsRead, useNotifications, type Notification } from "@/hooks/usePushNotification";
import { PanelTitleGroup } from "@/components/app/v3/PanelTitleGroup";
import { useScrollActivity } from "@/components/app/v3/useScrollActivity";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface SidebarNotificationItem {
    id: string;
    name: string;
    createdAt: string | null;
    notificationId?: number;
    message: string;
    url?: string;
    timeLabel: string;
    unread: boolean;
    tone: "default" | "warning";
    icon: "client" | "consultation";
}

const SIDEBAR_NOTIFICATIONS_MODAL_WIDTH = 352;

const CLIENT_AVATAR_GRADIENTS = [
  "bg-gradient-to-br from-[hsl(214,100%,34%)] to-[hsl(214,100%,28%)]",
  "bg-gradient-to-br from-[hsl(137,34%,31%)] to-[hsl(137,34%,25%)]",
  "bg-gradient-to-br from-[hsl(355,36%,45%)] to-[hsl(355,36%,38%)]",
  "bg-gradient-to-br from-[hsl(34,100%,55%)] to-[hsl(34,100%,45%)]",
  "bg-gradient-to-br from-[hsl(175,60%,40%)] to-[hsl(175,60%,30%)]",
  "bg-gradient-to-br from-[hsl(270,60%,55%)] to-[hsl(270,60%,45%)]",
];

const getClientAvatarGradient = (name: string) => {
  const charCode = name.charCodeAt(0) || 0;
  return CLIENT_AVATAR_GRADIENTS[charCode % CLIENT_AVATAR_GRADIENTS.length];
};

const getClientInitials = (name: string) => {
  const normalized = name.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (!normalized) {
    return "C";
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
  }

  return normalized.slice(0, 2).toUpperCase();
};

const getNotificationUrl = (notification: Notification): string | undefined => {
  const url = notification.data?.url;
  return typeof url === "string" ? url : undefined;
};

const formatNotificationTime = (value: string | Date | null | undefined) => {
  if (!value) {
    return "-";
  }

  const createdAt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(createdAt.getTime())) {
    return "-";
  }

  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60));

  if (diffMinutes < 0) {
    return createdAt.toLocaleTimeString("ko-KR", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  if (diffMinutes < 1) {
    return "방금 전";
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}분 전`;
  }

  if (diffMinutes <= 180) {
    return `${Math.floor(diffMinutes / 60)}시간 전`;
  }

  return createdAt.toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

export function SidebarNotifications() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [modalPosition, setModalPosition] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const { isScrollActive, handleScroll } = useScrollActivity();
  const { data: alerts = [] } = useClientAlerts(3);
  const { data: savedNotifications = [] } = useNotifications(5, 0, true);
  const markAsRead = useMarkAsRead();

  const notifications = React.useMemo<SidebarNotificationItem[]>(() => {
    const actionItems: SidebarNotificationItem[] = alerts.map((alert) => {
      const message = alert.reason === "교체 요청"
        ? "교체 요청이 접수되었습니다."
        : alert.reason === "서명 필요"
          ? "서비스 시작 전 서명이 필요합니다."
          : "서비스 시작 전 문서 발송이 필요합니다.";

      return {
        id: `action-${alert.id}`,
        name: alert.name,
        createdAt: alert.createdAt,
        message,
        timeLabel: formatNotificationTime(alert.createdAt),
        unread: true,
        tone: alert.priority === 1 ? "warning" : "default",
        icon: "client" as const,
      };
    });

    const notificationItems: SidebarNotificationItem[] = savedNotifications.map((notification) => {
      const url = getNotificationUrl(notification);
      const isConsultation = notification.data?.type === "consultation-inquiry";

      return {
        id: `notification-${notification.id}`,
        notificationId: notification.id,
        name: notification.title,
        createdAt: notification.sentAt,
        message: notification.body,
        url,
        timeLabel: formatNotificationTime(notification.sentAt),
        unread: !notification.isRead,
        tone: isConsultation ? "warning" : "default",
        icon: isConsultation ? "consultation" as const : "client" as const,
      };
    });

    return [...notificationItems, ...actionItems]
      .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())
      .slice(0, 6);
  }, [alerts, savedNotifications]);

  const unreadCount = notifications.filter((item) => item.unread).length;

  const handleNotificationClick = (notification: SidebarNotificationItem) => {
    if (notification.notificationId && notification.unread) {
      markAsRead.mutate(notification.notificationId);
    }

    if (notification.url) {
      setOpen(false);
      router.push(notification.url);
    }
  };

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open) {
      setModalPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }

      const rect = trigger.getBoundingClientRect();
      const modalWidth = SIDEBAR_NOTIFICATIONS_MODAL_WIDTH;
      const viewportWidth = window.innerWidth;
      const maxLeft = Math.max(12, viewportWidth - modalWidth - 12);
      setModalPosition({
        top: rect.bottom + 12,
        left: Math.min(maxLeft, Math.max(12, rect.left)),
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open]);

  const portalContent = open
    ? createPortal(
        <>
          <button
            type="button"
            aria-label="알림 닫기"
            data-component="sidebar-notifications-backdrop"
            className="fixed inset-0 z-[999] bg-slate-950/34 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {modalPosition ? (
            <div
              data-component="sidebar-notifications-modal"
              className="fixed z-[1000] w-[22rem] max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden"
              style={{ top: modalPosition.top, left: modalPosition.left }}
            >
              <div className="flex items-start justify-between p-6 pb-4 shrink-0">
                <PanelTitleGroup
                  component="list-panel"
                  title="알림"
                  subtitle="알림 항목들을 확인해 보세요."
                  titleClassName="text-xl"
                  subtitleClassName="text-[0.8rem]"
                />
                <button
                  type="button"
                  aria-label="알림 닫기"
                  data-component="sidebar-notifications-close"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-v3-text-muted transition-colors hover:bg-v3-dim-white hover:text-v3-dark"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div
                className="relative overflow-y-auto scrollbar-on-scroll min-h-0 flex-1 px-6 pt-3 flex flex-col"
                data-scroll-active={isScrollActive ? "true" : "false"}
                onScroll={handleScroll}
              >
                {notifications.length ? (
                  <div className="space-y-2">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        data-component="sidebar-notifications-item"
                        role={notification.url ? "button" : undefined}
                        tabIndex={notification.url ? 0 : undefined}
                        onClick={() => handleNotificationClick(notification)}
                        onKeyDown={(event) => {
                          if (!notification.url) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleNotificationClick(notification);
                          }
                        }}
                        className={cn(
                          "rounded-[18px] border border-v3-border/70 bg-white px-3 py-3",
                          notification.url && "cursor-pointer transition-colors hover:bg-v3-primary-light/45",
                          notification.unread && "border-v3-primary/20 bg-v3-primary-light/20",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar className="mt-0.5 h-8 w-8 shrink-0 shadow-sm">
                            <AvatarFallback
                              className={cn(
                                "text-[0.65rem] font-bold text-white",
                                notification.icon === "consultation"
                                  ? "bg-v3-primary"
                                  : getClientAvatarGradient(notification.name)
                              )}
                            >
                              {notification.icon === "consultation" ? (
                                <Headset className="h-4 w-4" />
                              ) : (
                                getClientInitials(notification.name)
                              )}
                            </AvatarFallback>
                          </Avatar>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-[0.8rem] font-semibold text-v3-dark">{notification.name}</p>
                              <span className="inline-flex items-center gap-1 whitespace-nowrap text-[0.68rem] font-medium text-v3-text-muted">
                                <Clock3 className="h-3.5 w-3.5" />
                                {notification.timeLabel}
                              </span>
                            </div>
                            <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">{notification.message}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    data-component="sidebar-notifications-empty"
                    className="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center"
                  >
                    <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-v3-dim-white text-v3-text-muted">
                      <Bell className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[0.85rem] font-semibold text-v3-dark">새 알림이 없습니다</p>
                      <p className="mt-1 text-[0.74rem] leading-5 text-v3-text-muted">
                        확인이 필요한 일정이나 상태 변경이 생기면 여기에 표시됩니다.
                      </p>
                    </div>
                  </div>
                )}
                <div className="sticky bottom-0 h-6 bg-white shrink-0" />
              </div>
            </div>
          ) : null}
        </>,
        document.body
      )
    : null;

  return (
    <div data-component="sidebar-notifications" className="relative ml-auto">
      <Button
        ref={triggerRef}
        type="button"
        size="icon"
        variant="ghost"
        data-component="sidebar-notifications-trigger"
        aria-label="알림 열기"
        aria-expanded={open}
        className={cn(
          "relative z-50 h-8 w-8 rounded-full border-0 bg-white text-v3-primary shadow-none [&_svg]:!size-5",
          "hover:bg-v3-primary-light hover:text-v3-primary"
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={20} />
        {unreadCount > 0 ? (
          <span
            data-component="sidebar-notifications-badge"
            className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-v3-primary p-0 text-[0.55rem] font-bold leading-none text-white"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>
      {portalContent}
    </div>
  );
}
