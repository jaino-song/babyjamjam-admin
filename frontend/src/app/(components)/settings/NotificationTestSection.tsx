"use client";

import { useState } from "react";
import { Box, Typography, Button, Alert, CircularProgress } from "@mui/material";
import { Bell } from "lucide-react";
import { api } from "@/app/lib/axios/client";

interface BroadcastResult {
    sent: number;
    failed: number;
}

export function NotificationTestSection() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<BroadcastResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleTestBroadcast = async () => {
        setLoading(true);
        setResult(null);
        setError(null);

        try {
            const { data } = await api.post<BroadcastResult>('/notifications/test-broadcast');
            setResult(data);
        } catch {
            setError('알림 전송에 실패했습니다.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Bell size={20} />
                알림 테스트
            </Typography>
            
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                모든 구독된 디바이스에 테스트 알림을 전송합니다.
            </Typography>

            <Button
                variant="contained"
                onClick={handleTestBroadcast}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <Bell size={16} />}
            >
                {loading ? '전송 중...' : '테스트 알림 보내기'}
            </Button>

            {result && (
                <Alert severity="success" sx={{ mt: 2 }}>
                    전송 완료 - 성공: {result.sent}건 / 실패: {result.failed}건
                </Alert>
            )}

            {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {error}
                </Alert>
            )}
        </Box>
    );
}
