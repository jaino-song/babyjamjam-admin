"use client"

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, Typography } from "@mui/material";
import { MoonLoader } from "react-spinners";
import { exchangeToken } from "./actions";

type ExchangeTokenResult = Awaited<ReturnType<typeof exchangeToken>>;

const exchangeTokenPromises = new Map<string, Promise<ExchangeTokenResult>>();

function exchangeTokenOnce(code: string): Promise<ExchangeTokenResult> {
    const existingPromise = exchangeTokenPromises.get(code);
    if (existingPromise) {
        return existingPromise;
    }

    const promise = exchangeToken(code).finally(() => {
        setTimeout(() => exchangeTokenPromises.delete(code), 60_000);
    });
    exchangeTokenPromises.set(code, promise);
    return promise;
}

export default function AuthCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const exchangeCodeForTokens = async () => {
            const callbackError = searchParams.get("error");
            if (callbackError) {
                setError(callbackError);
                return;
            }

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
                const result = await exchangeTokenOnce(code);

                if (cancelled) {
                    return;
                }
                
                if (!result.success) {
                    console.error("[Auth Callback] Token exchange failed:", result.error);
                    setError(result.error || "Authentication Failed");
                    return;
                }

                if (result.onboardingRequired) {
                    router.replace(result.onboardingRoute || "/kakao/onboarding");
                    return;
                }

                router.replace("/dashboard");
            }
            catch (err) {
                console.error("[Auth Callback] Token Exchange Error:", err);
                console.error("[Auth Callback] Error message:", err instanceof Error ? err.message : String(err));
                setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
            }
        }
        void exchangeCodeForTokens();

        return () => {
            cancelled = true;
        };
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
