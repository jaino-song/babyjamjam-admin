"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, Typography } from "@mui/material";
import { MoonLoader } from "react-spinners";
import { logout } from "./actions";

export default function LogoutPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const performLogout = async () => {
      const result = await logout();

      if (result.success) {
        // Redirect to login page after successful logout
        router.replace("/login");
      } else {
        setError(result.error || "로그아웃 중 오류가 발생했습니다.");
        // Still redirect to login after a short delay even on error
        setTimeout(() => {
          router.replace("/login");
        }, 2000);
      }
    };

    performLogout();
  }, [router]);

  if (error) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 2,
        }}
      >
        <Typography color="error">{error}</Typography>
        <Typography variant="body2" color="text.secondary">
          잠시 후 로그인 페이지로 이동합니다...
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: 2,
      }}
    >
      <MoonLoader size={40} />
      <Typography>로그아웃 중...</Typography>
    </Box>
  );
}
