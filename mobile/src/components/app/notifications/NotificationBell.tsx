"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ErrorFallback } from "@/components/app/ui/error-fallback";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    useUnreadCount,
    useNotifications,
    useMarkAsRead,
    useMarkAllAsRead,
    usePushNotification,
    Notification,
} from "@/hooks/usePushNotification";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { FilteredClientsDialog } from "./FilteredClientsDialog";
import { cn } from "@/lib/utils";
import { PWA_NOTIFICATIONS_ENABLED } from "@/lib/notification-config";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { normalizeApiError } from "@babyjamjam/shared";

type FilterType = "starting-soon" | "ending-soon" | "incomplete-contracts" | "no-contract";

export type ParsedNotificationUrl =
    | { type: "filter"; filterType: FilterType }
    | { type: "client"; clientId: number }
    | null;

export function parseNotificationUrl(url: string): ParsedNotificationUrl {
    // Match both formats:
    // - /clients/filtered?filter=starting-soon (new format)
    // - /clients?filter=starting-soon (old format)
    const filteredMatch = url.match(/\/clients(?:\/filtered)?\?filter=(.+)/);
    if (filteredMatch) {
        return { type: "filter", filterType: filteredMatch[1] as FilterType };
    }

    const clientMatch = url.match(/\/clients\?id=(\d+)/);
    if (clientMatch) {
        return { type: "client", clientId: parseInt(clientMatch[1]) };
    }

    return null;
}

interface GroupedNotifications {
    date: string;
    label: string;
    notifications: Notification[];
}

function formatDateLabel(date: Date): string {
    return formatDateForDisplay(date);
}

function groupNotificationsByDate(notifications: Notification[]): GroupedNotifications[] {
    if (!Array.isArray(notifications)) {
        return [];
    }

    const groups = new Map<string, Notification[]>();

    notifications.forEach((notification) => {
        const date = new Date(notification.sentAt);
        const dateKey = format(date, "yyyy-MM-dd");

        if (!groups.has(dateKey)) {
            groups.set(dateKey, []);
        }
        groups.get(dateKey)!.push(notification);
    });

    return Array.from(groups.entries()).map(([dateKey, items]) => ({
        date: dateKey,
        label: formatDateLabel(new Date(dateKey)),
        notifications: items,
    }));
}

/**
 * Unified Notification Bell Component
 *
 * Handles both subscription and notification display:
 * - Not subscribed: Click to enable notifications (dark gray icon)
 * - Subscribed: Click to view notifications (white icon with primary border)
 */
export function NotificationBell({
    "data-component": dataComponent,
    className,
}: {
    /** Caller-context canonical base, e.g. `mobile_shell_header_icons_notification-bell`. */
    "data-component"?: string;
    className?: string;
}) {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [subscribeLoading, setSubscribeLoading] = useState(false);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogFilterType, setDialogFilterType] = useState<FilterType | null>(null);
    const [dialogClientId, setDialogClientId] = useState<number | undefined>(undefined);
    const [expandedNotificationId, setExpandedNotificationId] = useState<number | null>(null);
    // Rows the user has already opened in this session read as read immediately,
    // without waiting for the mark-as-read refetch.
    const [openedNotificationIds, setOpenedNotificationIds] = useState<ReadonlySet<number>>(() => new Set());

    // Subscription state
    const {
        isSupported,
        isSubscribed,
        permission,
        error: subscriptionError,
        subscribe,
    } = usePushNotification();

    // Keep the in-app notification history available when PWA delivery is disabled.
    const notificationDataEnabled = !PWA_NOTIFICATIONS_ENABLED || isSubscribed;
    const {
        data: unreadCountData,
        isError: unreadCountIsError,
        error: unreadCountError,
        refetch: refetchUnreadCount,
        isFetching: unreadCountFetching,
    } = useUnreadCount(notificationDataEnabled);
    const {
        data: notificationsData,
        isLoading: notificationsLoading,
        isError: notificationsIsError,
        error: notificationsError,
        refetch: refetchNotifications,
        isFetching: notificationsFetching,
    } = useNotifications(10, 0, notificationDataEnabled);
    const unreadCount = typeof unreadCountData === "number" ? unreadCountData : undefined;
    const notifications = Array.isArray(notificationsData) ? notificationsData : [];
    const notificationsHasData = notificationsData !== undefined;
    const unreadCountNormalizedError = unreadCountError
        ? normalizeApiError(unreadCountError, { operation: "read", locale: "ko-KR" })
        : null;
    const notificationsNormalizedError = notificationsError
        ? normalizeApiError(notificationsError, { operation: "read", locale: "ko-KR" })
        : null;
    const showUnreadCountError = unreadCountIsError && Boolean(unreadCountNormalizedError) && !unreadCountNormalizedError?.suppress;
    const showNotificationsError = notificationsIsError && Boolean(notificationsNormalizedError) && !notificationsNormalizedError?.suppress;

    // Lock body scroll when modal is open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const markAsRead = useMarkAsRead();
    const markAllAsRead = useMarkAllAsRead();

    // Collapse any expanded notification whenever the popover closes, so it
    // always reopens collapsed instead of remembering the last expansion.
    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (!open) {
            setExpandedNotificationId(null);
        }
    };

    const handleClick = async () => {
        if (PWA_NOTIFICATIONS_ENABLED && !isSubscribed) {
            // Not subscribed - try to subscribe
            setSubscribeLoading(true);
            const success = await subscribe();
            setSubscribeLoading(false);

            if (!success) {
                // Show error in popover
                handleOpenChange(true);
            }
            // If success, state will update and next click will show notifications
        } else {
            // Subscribed - toggle popover
            handleOpenChange(!isOpen);
        }
    };

    const handleNotificationClick = (notification: Notification) => {
        if (!notification.isRead) {
            setOpenedNotificationIds((previous) => new Set(previous).add(notification.id));
            markAsRead.mutate(notification.id, {
                onError: () => {
                    setOpenedNotificationIds((previous) => {
                        const next = new Set(previous);
                        next.delete(notification.id);
                        return next;
                    });
                },
            });
        }

        if (notification.data?.url) {
            handleOpenChange(false);

            const url = notification.data.url as string;
            const parsed = parseNotificationUrl(url);

            if (parsed) {
                if (parsed.type === "filter") {
                    setDialogFilterType(parsed.filterType);
                    setDialogClientId(undefined);
                } else {
                    setDialogFilterType(null);
                    setDialogClientId(parsed.clientId);
                }
                setDialogOpen(true);
            } else {
                router.push(url);
            }
            return;
        }

        // No destination to navigate to — expand in place so staff can read
        // the full message instead of closing the popover.
        setExpandedNotificationId((prev) => (prev === notification.id ? null : notification.id));
    };

    const handleDialogClose = () => {
        setDialogOpen(false);
        setDialogFilterType(null);
        setDialogClientId(undefined);
    };

    const handleMarkAllAsRead = () => {
        markAllAsRead.mutate();
    };

    // Render error/warning content in popover
    const renderPopoverContent = () => {
        // Not supported
        if (PWA_NOTIFICATIONS_ENABLED && !isSupported) {
            return (
                <div className="p-4">
                    <Alert variant="warning">
                        <AlertDescription>
                            이 브라우저는 푸시 알림을 지원하지 않습니다.
                            <span className="block text-xs mt-2">
                                Chrome, Firefox, Edge 또는 Safari에서 사용해 주세요.
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // iOS PWA requirement
        const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isPWA = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

        if (PWA_NOTIFICATIONS_ENABLED && isIOS && !isPWA && !isSubscribed) {
            return (
                <div className="p-4">
                    <Alert>
                        <AlertDescription>
                            <p className="font-bold text-sm">iOS에서 알림을 받으려면:</p>
                            <span className="block text-xs mt-2">
                                1. Safari에서 공유 버튼 탭<br />
                                2. &quot;홈 화면에 추가&quot; 선택<br />
                                3. 홈 화면에서 앱 실행 후 알림 설정
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Permission denied
        if (PWA_NOTIFICATIONS_ENABLED && permission === 'denied') {
            return (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertDescription>
                            알림 권한이 차단되어 있습니다.
                            <span className="block text-xs mt-2">
                                브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Subscription error — usePushNotification stores locally authored
        // outcome copy only, so rendering it verbatim is contract-safe.
        if (PWA_NOTIFICATIONS_ENABLED && subscriptionError && !isSubscribed) {
            return (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertDescription>
                            알림 설정 중 오류가 발생했습니다.
                            <span className="block text-xs mt-2">
                                {subscriptionError}
                            </span>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }

        // Subscribed - show notifications list
        return (
            <>
                <div className="px-4 py-3 flex justify-between items-center bg-popover border-b">
                    <h2 className="text-lg font-semibold">알림</h2>
                    {unreadCount !== undefined && unreadCount > 0 && (
                        <Button
                            variant="link"
                            size="sm"
                            className="h-auto px-0"
                            onClick={handleMarkAllAsRead}
                            disabled={markAllAsRead.isPending}
                        >
                            모두 읽음
                        </Button>
                    )}
                </div>

                {showUnreadCountError ? (
                    <div className="px-4 pt-4">
                        <Alert
                            variant="warning"
                            role="status"
                            aria-live="polite"
                            data-component="mobile_notification-bell_unread-count-error"
                        >
                            <AlertTitle>읽지 않은 알림 수를 새로 불러오지 못했어요</AlertTitle>
                            <AlertDescription>
                                <p>{unreadCountNormalizedError?.message}</p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => void refetchUnreadCount()}
                                    disabled={unreadCountFetching}
                                >
                                    다시 시도
                                </Button>
                            </AlertDescription>
                        </Alert>
                    </div>
                ) : null}

                {showNotificationsError && !notificationsHasData ? (
                    <ErrorFallback
                        title="알림을 불러오지 못했어요"
                        description={notificationsNormalizedError?.message ?? "요청한 정보를 불러오지 못했어요."}
                        onReset={() => void refetchNotifications()}
                        className="min-h-0 px-4 py-8"
                    />
                ) : notificationsLoading && !notificationsHasData ? (
                    <div className="p-8 flex justify-center">
                        <Spinner size="default" />
                    </div>
                ) : (
                    <>
                        {showNotificationsError ? (
                            <div className="px-4 pt-4">
                                <Alert
                                    variant="warning"
                                    role="status"
                                    aria-live="polite"
                                    data-component="mobile_notification-bell_list-error"
                                >
                                    <AlertTitle>알림 목록을 새로 불러오지 못했어요</AlertTitle>
                                    <AlertDescription>
                                        <p>{notificationsNormalizedError?.message}</p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mt-3"
                                            onClick={() => void refetchNotifications()}
                                            disabled={notificationsFetching}
                                        >
                                            다시 시도
                                        </Button>
                                    </AlertDescription>
                                </Alert>
                            </div>
                        ) : null}
                        {notificationsLoading || (notificationsNormalizedError?.suppress && !notificationsHasData) ? (
                            <div className="p-8 flex justify-center">
                                <Spinner size="default" />
                            </div>
                        ) : notifications.length === 0 ? (
                    <div className="p-8 text-center">
                        <p className="text-muted-foreground">알림이 없습니다</p>
                    </div>
                        ) : (
                    <div className="max-h-80 overflow-y-auto scrollbar-hide">
                        {groupNotificationsByDate(notifications).map((group) => (
                            <div key={group.date}>
                                <div className="px-4 py-2 bg-muted sticky top-0">
                                    <span className="text-xs font-bold text-muted-foreground">
                                        {group.label}
                                    </span>
                                </div>
                                {group.notifications.map((notification) => {
                                    const isExpandable = !notification.data?.url;
                                    const isExpanded = isExpandable && expandedNotificationId === notification.id;
                                    const showsUnread = !notification.isRead && !openedNotificationIds.has(notification.id);
                                    const bodyId = `notification-body-${notification.id}`;

                                    return (
                                        <div
                                            key={notification.id}
                                            onClick={() => handleNotificationClick(notification)}
                                            onKeyDown={isExpandable ? (event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    handleNotificationClick(notification);
                                                }
                                            } : undefined}
                                            role={isExpandable ? 'button' : undefined}
                                            tabIndex={isExpandable ? 0 : undefined}
                                            aria-expanded={isExpandable ? isExpanded : undefined}
                                            aria-controls={isExpandable ? bodyId : undefined}
                                            data-testid={notification.isRead ? 'notification-item' : 'notification-item-unread'}
                                            className={`
                                                px-4 py-3 cursor-pointer border-b transition-colors
                                                bg-transparent hover:bg-muted
                                            `}
                                        >
                                            <div className="flex justify-between items-center">
                                                <p className="flex min-w-0 flex-1 items-start gap-2 text-sm font-bold">
                                                    {showsUnread && (
                                                        <>
                                                            <span
                                                                data-slot="unread-dot"
                                                                aria-hidden="true"
                                                                className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary"
                                                            />
                                                            <span className="sr-only">읽지 않음</span>
                                                        </>
                                                    )}
                                                    <span className={isExpanded ? 'break-words' : 'truncate'}>{notification.title}</span>
                                                </p>
                                                <span className="text-xs ml-2 shrink-0 text-muted-foreground">
                                                    {format(new Date(notification.sentAt), "a h:mm", { locale: ko })}
                                                </span>
                                            </div>
                                            <p
                                                id={bodyId}
                                                className={`text-xs mt-1 ${isExpanded ? 'whitespace-pre-wrap break-words' : 'truncate'} text-muted-foreground ${showsUnread ? 'pl-4' : ''}`}
                                            >
                                                {notification.body}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                        )}
                    </>
                )}
            </>
        );
    };

    const isLoading = subscribeLoading;

    return (
        <>
            {isOpen && createPortal(
                <div
                    className="fixed inset-0 top-16 bg-black/30 backdrop-blur-[4px] z-40 opacity-100 visible sm:hidden transition-all duration-300"
                    onClick={() => handleOpenChange(false)}
                />,
                document.body
            )}
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="알림 열기"
                        onClick={handleClick}
                        data-component={dataComponent}
                        data-testid="notification-bell"
                        className={cn("relative transition-transform duration-200 hover:scale-110 active:scale-95", className)}
                    >
                        {isLoading ? (
                            <Spinner size="sm" />
                        ) : !PWA_NOTIFICATIONS_ENABLED || isSubscribed ? (
                            <>
                                <Bell className="!h-5 !w-5 text-primary" />
                                {unreadCount !== undefined && unreadCount > 0 && (
                                    <Badge
                                        data-testid="notification-badge"
                                        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full p-0 text-xs animate-bounce-subtle"
                                    >
                                        {unreadCount > 99 ? '99+' : unreadCount}
                                    </Badge>
                                )}
                            </>
                        ) : (
                            <BellOff className="!h-5 !w-5 text-muted-foreground" />
                        )}
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    align="end"
                    sideOffset={8}
                    avoidCollisions={true}
                    collisionPadding={16}
                    className="!w-[80vw] sm:!w-[360px] max-h-[480px] min-h-[240px] p-0 overflow-hidden"
                    data-component={dataComponent ? `${dataComponent}_popover` : undefined}
                    data-testid="notification-popover"
                >
                    {renderPopoverContent()}
                </PopoverContent>
            </Popover>

            <FilteredClientsDialog
                open={dialogOpen}
                onClose={handleDialogClose}
                filterType={dialogFilterType}
                clientId={dialogClientId}
            />
        </>
    );
}
