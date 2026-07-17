"use server";

import { AxiosError } from "axios";
import { jwtDecode } from "jwt-decode";
import { cookies } from "next/headers";

import { serverAPIClient } from "@/app/lib/axios/server";
import { classifyTokenExchangeResponse } from "@/app/auth/callback/token-response";

type OnboardingMode = "account" | "kakao";

interface OnboardingInput {
  phone: string;
  birthDate: string;
  branchId: string;
  role: "admin" | "manager" | "user";
}

interface TokenPayload {
  role?: string | null;
}

const ACCOUNT_COOKIE = "pending_account_onboarding";
const KAKAO_COOKIE = "pending_kakao_signup";

export async function completeLegacyOnboarding(
  mode: OnboardingMode,
  input: OnboardingInput,
): Promise<{ success: boolean; error?: string }> {
  const cookieStore = await cookies();
  const pendingCookieName = mode === "account" ? ACCOUNT_COOKIE : KAKAO_COOKIE;
  const pendingToken = cookieStore.get(pendingCookieName)?.value;

  if (!pendingToken) {
    return { success: false, error: "가입 세션이 만료되었습니다. 다시 로그인해 주세요." };
  }

  const endpoint = mode === "account"
    ? "/auth/onboarding/complete"
    : "/auth/kakao/complete-signup";
  const headerName = mode === "account"
    ? "x-pending-onboarding-token"
    : "x-pending-signup-token";

  try {
    const { data } = await serverAPIClient.post(endpoint, {
      ...input,
      organizationId: input.branchId,
    }, {
      headers: { [headerName]: pendingToken },
    });
    const result = classifyTokenExchangeResponse(data);

    if (result.kind !== "authenticated") {
      return { success: false, error: "계정 정보를 저장하지 못했습니다." };
    }

    let role = "user";
    try {
      role = jwtDecode<TokenPayload>(result.accessToken).role || "user";
    } catch {
      role = "user";
    }

    cookieStore.set("auth_token", result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
    });
    cookieStore.set("refresh_token", result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });
    cookieStore.delete(ACCOUNT_COOKIE);
    cookieStore.delete(KAKAO_COOKIE);

    return { success: true };
  } catch (error) {
    if (error instanceof AxiosError) {
      const responseData = error.response?.data as { message?: string } | undefined;
      if (error.response?.status === 401) {
        cookieStore.delete(pendingCookieName);
      }
      return {
        success: false,
        error: responseData?.message || "계정 정보를 저장하지 못했습니다.",
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "계정 정보를 저장하지 못했습니다.",
    };
  }
}
