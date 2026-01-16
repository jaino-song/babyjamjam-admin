"use client";

import { Box, CircularProgress, Typography } from "@mui/material";
import { useServiceWorkerUpdate } from "@/app/hooks/useServiceWorkerUpdate";

export function ServiceWorkerUpdateOverlay() {
    const { isUpdating } = useServiceWorkerUpdate();

    if (!isUpdating) return null;

    return (
        <Box
            sx={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(255, 255, 255, 0.95)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 9999,
                gap: 2,
            }}
        >
            <CircularProgress size={48} />
            <Typography variant="h6" color="text.primary">
                앱 업데이트 중...
            </Typography>
            <Typography variant="body2" color="text.secondary">
                잠시만 기다려 주세요
            </Typography>
        </Box>
    );
}
