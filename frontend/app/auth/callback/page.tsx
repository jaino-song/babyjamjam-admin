"use client"

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/app/lib/axios/client";
import { AxiosError } from "axios";
import { Box, Typography } from "@mui/material";
import { MoonLoader } from "react-spinners";

type APIErrorReponse = {
    error: string;
}

export default function AuthCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const exchangeCodeForTokens = async () => {
            const code = searchParams.get("code");

            console.log("[Auth Callback] Starting token exchange");
            console.log("[Auth Callback] Code present:", !!code);

            if (!code) {
                console.error("[Auth Callback] No code in URL");
                setError("Authorization Code Required");
                return;
            }

            try {
                console.log("[Auth Callback] Calling /auth/token");
                console.log("[Auth Callback] Current origin:", window.location.origin);
                
                const response = await api.post("/auth/token", { code });
                console.log("[Auth Callback] Token exchange successful:", response.status);
                console.log("[Auth Callback] Redirecting to dashboard");
                router.replace("/dashboard");
            }
            catch (err) {
                console.error("Token Exchange Error: ", err);

                if (err instanceof AxiosError) {
                    const axiosError = err as AxiosError<APIErrorReponse>;
                    console.error("[Auth Callback] Axios error details:", {
                        code: axiosError.code,
                        message: axiosError.message,
                        status: axiosError.response?.status,
                    });
                    
                    // Handle network errors specifically (common on mobile Safari)
                    if (axiosError.code === "ERR_NETWORK") {
                        setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
                        return;
                    }
                    
                    setError(axiosError.response?.data?.error || "Authentication Failed");
                } else {
                    setError("Authentication Failed");
                }
            }
        }
        exchangeCodeForTokens();
    }, [searchParams, router]);

    if (error) {
        return (
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 2 }}>
                <Typography color="error">{error}</Typography>
                <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
                    onClick={() => router.push("/login")}
                >
                    로그인 페이지로 돌아가기
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 2 }}>
            <MoonLoader />
            <Typography>로그인 중...</Typography>
        </Box>
    );

}