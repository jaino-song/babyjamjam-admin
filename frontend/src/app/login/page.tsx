"use client";
import { Box, Button, Stack, Typography, Paper } from "@mui/material";
import GoogleIcon from "@mui/icons-material/Google";
import { RiKakaoTalkFill } from "react-icons/ri";
import { t } from "../lib/i18n/translations";
import { useLocale } from "../(components)/LocaleProvider";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

const LoginPage = () => {
  const locale = useLocale();

  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
      <Paper component="main" elevation={3} sx={{ bgcolor: "#fff", px: 3, py: 6, borderRadius: "8px", mx: 2 }}>
        <Stack spacing={3}>
          <Typography variant="h1" align="center" sx={{ fontSize: "1.5rem", fontWeight: "bold" }}>{t(locale, "login.title")}</Typography>
          <Typography variant="h2" align="center" sx={{ fontSize: "1rem", fontWeight: "semi", lineHeight: "1.5rem" }}>{t(locale, "login.subtitle")}</Typography>
          <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 1.5 }}>
            <Button
              variant="outlined"
              fullWidth
              startIcon={<RiKakaoTalkFill />}
              sx={{
                color: "#000000",
                borderColor: "#dadce0",
                bgcolor: "#FEE500",
                textTransform: "none",
                py: 1.5,
                "&:hover": {
                  borderColor: "#d2e3fc",
                  bgcolor: "#e1cb01ff",
                },
              }}
              onClick={() => {
                window.location.href = `${API_BASE_URL}/auth/kakao`;
              }}
            >
              {t(locale, "login.kakao-login")}
            </Button>
            <Button
              disabled
              variant="outlined"
              fullWidth
              startIcon={<GoogleIcon />}
              sx={{
                color: "text.primary",
                borderColor: "#dadce0",
                bgcolor: "#ffffff",
                textTransform: "none",
                py: 1.5,
                "&:hover": {
                  borderColor: "#d2e3fc",
                  bgcolor: "rgba(66, 133, 244, 0.04)",
                },
              }}
              onClick={() => {
                window.location.href = `${API_BASE_URL}/auth/google`;
              }}
            >
              {t(locale, "login.google-login")}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Box>
  )
}

export default LoginPage