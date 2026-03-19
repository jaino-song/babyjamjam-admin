"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AUTH_ROUTES } from "@/lib/auth/routes";
import { exchangeToken } from "@/app/(auth)/callback/actions";

export function useCallbackPageController() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const exchangeCodeForTokens = async () => {
      const code = searchParams.get("code");

      if (!code) {
        console.error("[Auth Callback] No code in URL");
        if (!cancelled) {
          setError("Authorization Code Required");
        }
        return;
      }

      try {
        const result = await exchangeToken(code);

        if (cancelled) {
          return;
        }

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
      } catch (requestError) {
        if (cancelled) {
          return;
        }

        console.error("[Auth Callback] Token Exchange Error:", requestError);
        console.error(
          "[Auth Callback] Error message:",
          requestError instanceof Error ? requestError.message : String(requestError),
        );
        setError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
      }
    };

    void exchangeCodeForTokens();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return {
    error,
    status: error ? "error" : "loading",
    goToLogin: () => router.push(AUTH_ROUTES.login),
  };
}
