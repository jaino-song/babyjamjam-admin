"use client";

import { useState } from "react";
import {
    Badge,
    IconButton,
    Popover,
    List,
    ListItem,
    ListItemText,
    Typography,
    Box,
    Button,
    Divider,
    CircularProgress,
    Alert,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import {
    useUnreadCount,
    useNotifications,
    useMarkAsRead,
    useMarkAllAsRead,
    usePushNotification,
    Notification,
} from "@/app/hooks/usePushNotification";
import { format, isToday, isYesterday } from "date-fns";
import { ko } from "date-fns/locale";

interface GroupedNotifications {
    date: string;
    label: string;
    notifications: Notification[];
}

function formatDateLabel(date: Date): string {
    if (isToday(date)) {
        return "오늘";
    }
    if (isYesterday(date)) {
        return "어제";
    }
    return format(date, "M월 d일 EEEE", { locale: ko });
}

function groupNotificationsByDate(notifications: Notification[]): GroupedNotifications[] {
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
export function NotificationBell() {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const [subscribeLoading, setSubscribeLoading] = useState(false);

    // Subscription state
    const {
        isSupported,
        isSubscribed,
        permission,
        isLoading: subscriptionLoading,
        error: subscriptionError,
        subscribe,
    } = usePushNotification();

    // Notification data (only fetch when subscribed)
    const { data: unreadCount = 0 } = useUnreadCount();
    const { data: notifications = [], isLoading: notificationsLoading } = useNotifications(10, 0);
    const markAsRead = useMarkAsRead();
    const markAllAsRead = useMarkAllAsRead();

    const open = Boolean(anchorEl);

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
        if (!isSubscribed) {
            // Not subscribed - try to subscribe
            setSubscribeLoading(true);
            const success = await subscribe();
            setSubscribeLoading(false);

            if (!success) {
                // Show error in popover
                setAnchorEl(event.currentTarget);
            }
            // If success, state will update and next click will show notifications
        } else {
            // Subscribed - show notifications popover
            setAnchorEl(event.currentTarget);
        }
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleNotificationClick = (notification: Notification) => {
        if (!notification.isRead) {
            markAsRead.mutate(notification.id);
        }
        // Navigate to URL if present
        if (notification.data?.url) {
            window.location.href = notification.data.url as string;
        }
        handleClose();
    };

    const handleMarkAllAsRead = () => {
        markAllAsRead.mutate();
    };

    // Render error/warning content in popover
    const renderPopoverContent = () => {
        // Not supported
        if (!isSupported) {
            return (
                <Box sx={{ p: 2 }}>
                    <Alert severity="warning">
                        이 브라우저는 푸시 알림을 지원하지 않습니다.
                        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                            Chrome, Firefox, Edge 또는 Safari에서 사용해 주세요.
                        </Typography>
                    </Alert>
                </Box>
            );
        }

        // iOS PWA requirement
        const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isPWA = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

        if (isIOS && !isPWA && !isSubscribed) {
            return (
                <Box sx={{ p: 2 }}>
                    <Alert severity="info">
                        <Typography variant="body2" fontWeight="bold">
                            iOS에서 알림을 받으려면:
                        </Typography>
                        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                            1. Safari에서 공유 버튼 탭<br />
                            2. &quot;홈 화면에 추가&quot; 선택<br />
                            3. 홈 화면에서 앱 실행 후 알림 설정
                        </Typography>
                    </Alert>
                </Box>
            );
        }

        // Permission denied
        if (permission === 'denied') {
            return (
                <Box sx={{ p: 2 }}>
                    <Alert severity="error">
                        알림 권한이 차단되어 있습니다.
                        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                            브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.
                        </Typography>
                    </Alert>
                </Box>
            );
        }

        // Subscription error
        if (subscriptionError && !isSubscribed) {
            return (
                <Box sx={{ p: 2 }}>
                    <Alert severity="error">
                        알림 설정 중 오류가 발생했습니다.
                        <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                            {subscriptionError}
                        </Typography>
                    </Alert>
                </Box>
            );
        }

        // Subscribed - show notifications list
        return (
            <>
                <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">알림</Typography>
                    {unreadCount > 0 && (
                        <Button
                            size="small"
                            onClick={handleMarkAllAsRead}
                            disabled={markAllAsRead.isPending}
                        >
                            모두 읽음
                        </Button>
                    )}
                </Box>

                <Divider />

                {notificationsLoading ? (
                    <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : notifications.length === 0 ? (
                    <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Typography color="text.secondary">
                            알림이 없습니다
                        </Typography>
                    </Box>
                ) : (
                    <List sx={{ py: 0 }}>
                        {groupNotificationsByDate(notifications).map((group) => (
                            <Box key={group.date}>
                                <Box
                                    sx={{
                                        px: 2,
                                        py: 1,
                                        bgcolor: 'grey.100',
                                        position: 'sticky',
                                        top: 0,
                                    }}
                                >
                                    <Typography variant="caption" fontWeight="bold" color="text.secondary">
                                        {group.label}
                                    </Typography>
                                </Box>
                                {group.notifications.map((notification) => (
                                    <ListItem
                                        key={notification.id}
                                        onClick={() => handleNotificationClick(notification)}
                                        sx={{
                                            cursor: 'pointer',
                                            bgcolor: notification.isRead ? 'transparent' : 'action.hover',
                                            '&:hover': {
                                                bgcolor: 'action.selected',
                                            },
                                        }}
                                        divider
                                    >
                                        <ListItemText
                                            primary={
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <Typography
                                                        variant="body2"
                                                        fontWeight={notification.isRead ? 'normal' : 'bold'}
                                                    >
                                                        {notification.title}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.disabled" sx={{ ml: 1, flexShrink: 0 }}>
                                                        {format(new Date(notification.sentAt), "a h:mm", { locale: ko })}
                                                    </Typography>
                                                </Box>
                                            }
                                            secondary={
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    component="span"
                                                    display="block"
                                                    sx={{
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {notification.body}
                                                </Typography>
                                            }
                                        />
                                    </ListItem>
                                ))}
                            </Box>
                        ))}
                    </List>
                )}
            </>
        );
    };

    const isLoading = subscriptionLoading || subscribeLoading;

    return (
        <>
            <IconButton
                onClick={handleClick}
                disabled={isLoading}
                color="inherit"
            >
                {isLoading ? (
                    <CircularProgress size={24} color="inherit" />
                ) : isSubscribed ? (
                    <Badge badgeContent={unreadCount} color="error">
                        {/* Subscribed: White filled bell with primary.main outline */}
                        <NotificationsIcon
                            sx={(theme) => ({
                                color: 'white',
                                stroke: theme.palette.primary.main,
                                strokeWidth: 1,
                            })}
                        />
                    </Badge>
                ) : (
                    // Not subscribed: dark gray bell
                    <NotificationsOffIcon sx={{ color: 'text.disabled' }} />
                )}
            </IconButton>

            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
                PaperProps={{
                    sx: { width: 360, maxHeight: 480 },
                }}
            >
                {renderPopoverContent()}
            </Popover>
        </>
    );
}
