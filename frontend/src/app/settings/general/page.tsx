"use client";

import {
  Box,
  Paper,
  Typography,
  Switch,
  FormControlLabel,
  Divider,
  RadioGroup,
  Radio,
  CircularProgress,
  Alert,
  Snackbar,
} from "@mui/material";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi, AlimtalkProvider } from "@/services/api";
import { MessageSquare } from "lucide-react";

const PROVIDER_OPTIONS: { value: AlimtalkProvider; label: string; description: string }[] = [
  {
    value: "aligo",
    label: "알리고 (Aligo)",
    description: "알리고 알림톡 API를 통해 카카오 알림톡을 발송합니다.",
  },
  {
    value: "channeltalk",
    label: "채널톡 (Channel Talk)",
    description: "채널톡 마케팅 자동화를 통해 알림톡을 발송합니다.",
  },
  {
    value: "none",
    label: "사용 안함",
    description: "알림톡 발송을 비활성화합니다.",
  },
];

export default function GeneralSettingsPage() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: "success" | "error" }>({
    open: false,
    message: "",
    severity: "success",
  });

  const queryClient = useQueryClient();

  const { data: alimtalkSettings, isLoading: isLoadingAlimtalk, error: alimtalkError } = useQuery({
    queryKey: ["settings", "alimtalk-provider"],
    queryFn: settingsApi.getAlimtalkProvider,
  });

  const updateAlimtalkMutation = useMutation({
    mutationFn: settingsApi.updateAlimtalkProvider,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "alimtalk-provider"], data);
      setSnackbar({
        open: true,
        message: "알림톡 설정이 저장되었습니다.",
        severity: "success",
      });
    },
    onError: () => {
      setSnackbar({
        open: true,
        message: "설정 저장에 실패했습니다. 다시 시도해주세요.",
        severity: "error",
      });
    },
  });

  const handleProviderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newProvider = event.target.value as AlimtalkProvider;
    updateAlimtalkMutation.mutate(newProvider);
  };

  const handleCloseSnackbar = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Paper elevation={2} sx={{ p: 3 }}>
        <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2 }}>
          <MessageSquare size={24} className="text-yellow-600" />
          <Box>
            <Typography variant="h6" gutterBottom sx={{ mb: 0 }}>
              알림톡 설정
            </Typography>
            <Typography variant="body2" color="text.secondary">
              카카오 알림톡 발송 서비스를 선택합니다.
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ mb: 3 }} />

        {isLoadingAlimtalk ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : alimtalkError ? (
          <Alert severity="error">설정을 불러오는데 실패했습니다.</Alert>
        ) : (
          <RadioGroup
            value={alimtalkSettings?.provider || "aligo"}
            onChange={handleProviderChange}
          >
            {PROVIDER_OPTIONS.map((option) => (
              <Box key={option.value} sx={{ mb: 2 }}>
                <FormControlLabel
                  value={option.value}
                  control={<Radio disabled={updateAlimtalkMutation.isPending} />}
                  label={
                    <Box>
                      <Typography variant="body1" fontWeight={500}>
                        {option.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {option.description}
                      </Typography>
                    </Box>
                  }
                  sx={{ alignItems: "flex-start", ml: 0 }}
                />
              </Box>
            ))}
          </RadioGroup>
        )}

        {alimtalkSettings?.updatedAt && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: "block" }}>
            마지막 수정: {new Date(alimtalkSettings.updatedAt).toLocaleString("ko-KR")}
          </Typography>
        )}
      </Paper>

      <Paper elevation={2} sx={{ p: 3 }}>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom>
            기타 설정
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

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: "100%" }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
