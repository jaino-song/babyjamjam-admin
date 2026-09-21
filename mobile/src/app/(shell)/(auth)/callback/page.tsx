"use client"


import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { normalizeApiError } from "@babyjamjam/shared";
import { Spinner } from "@/components/ui/spinner";
import { exchangeToken } from "./actions";
import { getSafeCallbackError } from "@/lib/auth/auth-errors";
import { resetAuthorityState } from "@/lib/auth/authority-state";

/** Canonical data-component base for the /callback route. */
const CALLBACK_BASE = "mobile_auth_callback";

export default function AuthCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const exchangeCodeForTokens = async () => {
            const oauthError = searchParams.get("error");
            const code = searchParams.get("code");

            console.log("[Auth Callback] Starting token exchange");
            console.log("[Auth Callback] Code present:", !!code);

            if (oauthError) {
                console.error("[Auth Callback] OAuth provider returned an error");
                // getSafeCallbackError returns sanitized, locally authored copy.
                setError(getSafeCallbackError(oauthError));
                return;
            }

            if (!code) {
                console.error("[Auth Callback] No code in URL");
                setError("인증 코드가 없어요. 다시 로그인해 주세요.");
                return;
            }

            try {
                await resetAuthorityState();
                console.log("[Auth Callback] Using server action for token exchange");

                // Use server action - bypasses Safari's client-side restrictions
                const result = await exchangeToken(code);

                if (!result.success) {
                    console.error("[Auth Callback] Token exchange failed:", result.error);
                    // The server action already normalizes the failure through
                    // the problem contract; render its copy verbatim.
                    setError(result.error || "카카오 로그인에 실패했어요. 다시 로그인해 주세요.");
                    return;
                }

                console.log("[Auth Callback] Token exchange successful");

                // Every navigation below crosses an identity boundary (new
                // account/branch session). The shared (shell) layout would not
                // re-render its server-rendered UserProvider on a soft navigation, so
                // reload the document instead.
                if (result.onboardingRequired) {
                    window.location.replace(result.onboardingRoute || "/kakao/onboarding");
                    return;
                }

                if (result.requiresBranchSelection) {
                    console.log("[Auth Callback] Multiple branches detected, redirecting to selection");
                    window.location.replace("/select-branch");
                } else {
                    console.log("[Auth Callback] Redirecting to dashboard");
                    window.location.replace("/dashboard");
                }
            }
            catch (err) {
                console.error("[Auth Callback] Token Exchange Error:", err);
                console.error("[Auth Callback] Error message:", err instanceof Error ? err.message : String(err));
                // Shared problem contract resolution — upstream internals are
                // never rendered; the normalized message is already safe copy.
                setError(normalizeApiError(err, { locale: "ko-KR", operation: "mutation" }).message);
            }
        }
        exchangeCodeForTokens();
    }, [searchParams]);

    if (error) {
        return (
            <div data-component={CALLBACK_BASE} data-slot="auth-callback-page" className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
                <p className="text-destructive">{error}</p>
                <button
                    data-component={`${CALLBACK_BASE}_login-button`}
                    className="text-sm text-muted-foreground cursor-pointer hover:underline"
                    onClick={() => router.push("/login")}
                >
                    로그인 페이지로 돌아가기
                </button>
            </div>
        );
    }

    return (
        <div data-component={CALLBACK_BASE} data-slot="auth-callback-page" className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
            <Spinner size="lg" />
            <p className="text-foreground">로그인 중...</p>
        </div>
    );
}
