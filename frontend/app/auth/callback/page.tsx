"use client"

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Typography } from "@mui/material";
import { MoonLoader } from "react-spinners";
import { exchangeToken } from "./actions";

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
                console.log("[Auth Callback] Using server action for token exchange");
                
                // Use server action - bypasses Safari's client-side restrictions
                const result = await exchangeToken(code);
                
                if (!result.success) {
                    console.error("[Auth Callback] Token exchange failed:", result.error);
                    setError(result.error || "Authentication Failed");
                    return;
                }

                console.log("[Auth Callback] Token exchange successful");
                console.log("[Auth Callback] Redirecting to dashboard");
                router.replace("/dashboard");
            }
            catch (err) {
                console.error("[Auth Callback] Token Exchange Error:", err);
                console.error("[Auth Callback] Error message:", err instanceof Error ? err.message : String(err));
                setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
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