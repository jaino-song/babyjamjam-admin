"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";

interface TokenPayload {
    sub: string;
    role: string | null;
    type: "access" | "refresh";
}

interface CompleteAccountOnboardingInput {
    phone: string;
    birthDate: string;
    organizationId: string;
    role: string;
}

interface CompleteAccountOnboardingSuccessResponse {
    accessToken: string;
    refreshToken: string;
    requiresOrgSelection?: boolean;
}

const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";
const PENDING_ONBOARDING_TOKEN_HEADER = "x-pending-onboarding-token";

export async function completeAccountOnboarding(
    input: CompleteAccountOnboardingInput,
): Promise<{ success: boolean; error?: string; requiresOrgSelection?: boolean }> {
    const cookieStore = await cookies();
    const pendingOnboardingToken = cookieStore.get(PENDING_ACCOUNT_ONBOARDING_COOKIE)?.value;

    if (!pendingOnboardingToken) {
        return {
            success: false,
            error: "계정 정보 입력 세션이 만료되었습니다. 다시 로그인해 주세요.",
        };
    }

    try {
        const response = await serverAPIClient.post<CompleteAccountOnboardingSuccessResponse>(
            "/auth/onboarding/complete",
            input,
            {
                headers: {
                    [PENDING_ONBOARDING_TOKEN_HEADER]: pendingOnboardingToken,
                },
            },
        );

        if (response.status >= 400) {
            if (response.status === 401) {
                cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);
            }

            const message = typeof response.data === "object" && response.data && "message" in response.data
                ? String(response.data.message)
                : "계정 정보를 저장하지 못했습니다. 다시 시도해 주세요.";

            return {
                success: false,
                error: message,
            };
        }

        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(response.data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("[Account Onboarding] Failed to decode token");
        }

        const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";

        cookieStore.set("auth_token", response.data.accessToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
            maxAge: role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
        });

        cookieStore.set("refresh_token", response.data.refreshToken, {
            httpOnly: true,
            secure: isSecureCookie,
            sameSite: "lax",
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
        });

        cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);

        return {
            success: true,
            requiresOrgSelection: response.data.requiresOrgSelection || false,
        };
    } catch (error) {
        if (error instanceof AxiosError) {
            const message = error.response?.data?.message || "계정 정보를 저장하지 못했습니다. 다시 시도해 주세요.";
            return { success: false, error: message };
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
