"use server"

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

interface CompleteAccountOnboardingInput {
    phone: string;
    birthDate: string;
    branchId: string;
    role: string;
}

interface CompleteAccountOnboardingSuccessResponse {
    accessToken: string;
    refreshToken: string;
    requiresBranchSelection?: boolean;
    requiresOrgSelection?: boolean;
}

const PENDING_ACCOUNT_ONBOARDING_COOKIE = "pending_account_onboarding";
const PENDING_ONBOARDING_TOKEN_HEADER = "x-pending-onboarding-token";

export async function completeAccountOnboarding(
    input: CompleteAccountOnboardingInput,
): Promise<{ success: boolean; error?: string; requiresBranchSelection?: boolean }> {
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
            {
                ...input,
                organizationId: input.branchId,
            },
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

        setAuthSessionCookies(cookieStore, {
            accessToken: response.data.accessToken,
            refreshToken: response.data.refreshToken,
        });

        cookieStore.delete(PENDING_ACCOUNT_ONBOARDING_COOKIE);

        return {
            success: true,
            requiresBranchSelection: Boolean(response.data.requiresBranchSelection || response.data.requiresOrgSelection),
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
