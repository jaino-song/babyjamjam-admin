"use client"

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { exchangeToken } from "./actions";

export default function AuthCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const exchangeCodeForTokens = async () => {
            const code = searchParams.get("code");

            if (!code) {
                console.error("[Auth Callback] No code in URL");
                setError("Authorization Code Required");
                return;
            }

            try {
                // Use server action - bypasses Safari's client-side restrictions
                const result = await exchangeToken(code);

                if (!result.success) {
                    console.error("[Auth Callback] Token exchange failed:", result.error);
                    setError(result.error || "Authentication Failed");
                    return;
                }

                if (result.requiresOrgSelection) {
                    router.replace("/select-organization");
                } else {
                    router.replace("/dashboard");
                }
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
            <div data-component="auth-callback" className="flex flex-col items-center justify-center h-screen gap-4">
                <p className="text-destructive">{error}</p>
                <button
                    data-component="auth-callback-login-btn"
                    className="text-sm text-muted-foreground cursor-pointer hover:underline"
                    onClick={() => router.push("/login")}
                >
                    로그인 페이지로 돌아가기
                </button>
            </div>
        );
    }

    return (
        <div data-component="auth-callback" className="flex flex-col items-center justify-center h-screen gap-4">
            <Spinner size="lg" />
            <p className="text-foreground">로그인 중...</p>
        </div>
    );
}
