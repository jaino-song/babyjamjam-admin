"use server";

import { cookies } from "next/headers";
import axios from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { getServerRuntimeConfig } from "@/lib/env";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, decodeAccessRole, getRefreshSessionMaxAgeSeconds } from "@/lib/auth/session-policy";

interface OnboardingInput {
  phone: string;
  birthDate: string;
  branchId: string;
  role: string;
}

export async function completeAccountOnboarding(input: OnboardingInput) {
  const cookieStore = await cookies();
  const pendingToken = cookieStore.get("pending_account_onboarding")?.value;
  if (!pendingToken) return { success: false, error: "계정 정보 입력 세션이 만료되었습니다. 다시 로그인해 주세요." };

  try {
    const { data } = await serverAPIClient.post("/auth/onboarding/complete", input, {
      headers: { "x-pending-onboarding-token": pendingToken },
    });
    const secure = getServerRuntimeConfig().isSecureCookieEnv;
    const role = decodeAccessRole(data.accessToken);
    cookieStore.set("auth_token", data.accessToken, {
      httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
    });
    cookieStore.set("refresh_token", data.refreshToken, {
      httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: getRefreshSessionMaxAgeSeconds(role),
    });
    cookieStore.delete("pending_account_onboarding");
    return { success: true, requiresBranchSelection: Boolean(data.requiresBranchSelection || data.requiresOrgSelection) };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) cookieStore.delete("pending_account_onboarding");
    return {
      success: false,
      error: axios.isAxiosError(error)
        ? error.response?.data?.message || "계정 정보를 저장하지 못했습니다. 다시 시도해 주세요."
        : "계정 정보를 저장하지 못했습니다. 다시 시도해 주세요.",
    };
  }
}
