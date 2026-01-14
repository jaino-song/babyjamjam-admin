"use client";

import { Box, Paper, Typography, Switch, FormControlLabel, Divider } from "@mui/material";
import { useState } from "react";

export default function GeneralSettingsPage() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          일반 설정
        </Typography>
        <Typography variant="body2" color="text.secondary">
          시스템 환경 설정을 관리합니다.
        </Typography>
      </Box>

      <Divider sx={{ mb: 3 }} />

      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={notifications}
              onChange={(e) => setNotifications(e.target.checked)}
            />
          }
          label="알림 수신"
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 6, mt: -1 }}>
          시스템 알림 및 중요 업데이트를 이메일로 수신합니다.
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={darkMode}
              onChange={(e) => setDarkMode(e.target.checked)}
            />
          }
          label="다크 모드 (준비 중)"
          disabled
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 6, mt: -1 }}>
          어두운 테마로 전환합니다. (추후 지원 예정)
        </Typography>
      </Box>
    </Paper>
  );
}
