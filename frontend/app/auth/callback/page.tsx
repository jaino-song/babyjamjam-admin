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

            if (!code) {
                setError("Authorization Code Required");
                return;
            }

            try {
                await api.post("/auth/token", { code });
                router.replace("/dashboard");
            }
            catch (err) {
                console.error("Token Exchange Error: ", err);

                if (err instanceof AxiosError<APIErrorReponse>) {
                    setError(err.response?.data.error || "Authentication Failed");
                }
                setError("Authentication Failed");
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