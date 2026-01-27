"use client";

import { useState } from "react";
import {
    Box,
    Button,
    Typography,
    Switch,
    FormControlLabel,
    Alert,
    CircularProgress,
    Paper,
} from "@mui/material";
import NotificationsActiveIcon from "@mui/icons-material/NotificationsActive";
import NotificationsOffIcon from "@mui/icons-material/NotificationsOff";
import { usePushNotification } from "@/app/hooks/usePushNotification";

/**
 * Notification Settings Component
 *
 * Allows users to subscribe/unsubscribe from PWA push notifications.
 * Shows current subscription status and handles permission requests.
 */
export function NotificationSettings() {
    const {
        isSupported,
        isSubscribed,
        permission,
        isLoading,
        error,
        subscribe,
        unsubscribe,
    } = usePushNotification();

    const [actionLoading, setActionLoading] = useState(false);

    const handleToggle = async () => {
        setActionLoading(true);
        try {
            if (isSubscribed) {
                await unsubscribe();
            } else {
                await subscribe();
            }
        } finally {
            setActionLoading(false);
        }
    };

    // Not supported message
    if (!isSupported) {
        return (
            <Alert severity="warning" sx={{ mt: 2 }}>
                이 브라우저는 푸시 알림을 지원하지 않습니다.
                <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    Chrome, Firefox, Edge 또는 Safari에서 사용해 주세요.
                </Typography>
            </Alert>
        );
    }

    // iOS PWA requirement message
    const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isPWA = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

    if (isIOS && !isPWA) {
        return (
            <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2" fontWeight="bold">
                    iOS에서 알림을 받으려면:
                </Typography>
                <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    1. Safari에서 공유 버튼 탭<br />
                    2. &quot;홈 화면에 추가&quot; 선택<br />
                    3. 홈 화면에서 앱 실행 후 알림 설정
                </Typography>
            </Alert>
        );
    }

    // Permission denied message
    if (permission === 'denied') {
        return (
            <Alert severity="error" sx={{ mt: 2 }}>
                알림 권한이 차단되어 있습니다.
                <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    브라우저 설정에서 이 사이트의 알림 권한을 허용해 주세요.
                </Typography>
            </Alert>
        );
    }

    const loading = isLoading || actionLoading;

    return (
        <Paper data-component="notification-settings-paper" variant="outlined" sx={{ p: 2, mt: 2 }}>
            <Box display="flex" alignItems="center" justifyContent="space-between">
                <Box display="flex" alignItems="center" gap={1}>
                    {isSubscribed ? (
                        <NotificationsActiveIcon color="primary" />
                    ) : (
                        <NotificationsOffIcon color="disabled" />
                    )}
                    <Box>
                        <Typography variant="body1" fontWeight="medium">
                            푸시 알림
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {isSubscribed ? '알림을 받고 있습니다' : '알림이 비활성화되어 있습니다'}
                        </Typography>
                    </Box>
                </Box>

                {loading ? (
                    <CircularProgress size={24} />
                ) : (
                    <FormControlLabel
                        control={
                            <Switch
                                checked={isSubscribed}
                                onChange={handleToggle}
                                disabled={loading}
                            />
                        }
                        label=""
                    />
                )}
            </Box>

            {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {error}
                </Alert>
            )}
        </Paper>
    );
}

/**
 * Quick Subscribe Button
 *
 * Simple button to enable notifications from anywhere in the app.
 */
export function NotificationSubscribeButton() {
    const { isSupported, isSubscribed, isLoading, subscribe } = usePushNotification();
    const [loading, setLoading] = useState(false);

    if (!isSupported || isSubscribed) {
        return null;
    }

    const handleClick = async () => {
        setLoading(true);
        try {
            await subscribe();
        } finally {
            setLoading(false);
        }
    };

    return (
        <Button
            variant="outlined"
            size="small"
            onClick={handleClick}
            disabled={isLoading || loading}
            startIcon={loading ? <CircularProgress size={16} /> : <NotificationsActiveIcon />}
        >
            알림 받기
        </Button>
    );
}
