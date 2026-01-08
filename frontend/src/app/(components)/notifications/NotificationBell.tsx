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
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import { useUnreadCount, useNotifications, useMarkAsRead, useMarkAllAsRead, Notification } from "@/app/hooks/usePushNotification";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

/**
 * Notification Bell Component
 *
 * Shows unread notification count badge and popover with recent notifications.
 */
export function NotificationBell() {
    const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
    const { data: unreadCount = 0 } = useUnreadCount();
    const { data: notifications = [], isLoading } = useNotifications(10, 0);
    const markAsRead = useMarkAsRead();
    const markAllAsRead = useMarkAllAsRead();

    const handleOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
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

    const open = Boolean(anchorEl);

    return (
        <>
            <IconButton onClick={handleOpen} color="inherit">
                <Badge badgeContent={unreadCount} color="error">
                    <NotificationsIcon />
                </Badge>
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

                {isLoading ? (
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
                        {notifications.map((notification) => (
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
                                        <Typography
                                            variant="body2"
                                            fontWeight={notification.isRead ? 'normal' : 'bold'}
                                        >
                                            {notification.title}
                                        </Typography>
                                    }
                                    secondary={
                                        <>
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
                                            <Typography variant="caption" color="text.disabled">
                                                {formatDistanceToNow(new Date(notification.sentAt), {
                                                    addSuffix: true,
                                                    locale: ko,
                                                })}
                                            </Typography>
                                        </>
                                    }
                                />
                            </ListItem>
                        ))}
                    </List>
                )}
            </Popover>
        </>
    );
}
