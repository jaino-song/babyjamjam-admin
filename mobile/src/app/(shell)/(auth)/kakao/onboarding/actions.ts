"use server";

import { cookies } from "next/headers";
import axios from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { normalizeApiError } from "@babyjamjam/shared";

interface OnboardingInput {
  phone: string;
  birthDate: string;
  role: string;
}

// Locally authored failure copy — upstream body messages are never forwarded
// to the client flow.
const KAKAO_SIGNUP_FAILURE_COPY = "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.";

function kakaoSignupFailure(status: number, data: unknown): string {
  const normalized = normalizeApiError(
    { response: { status, data } },
    { locale: "ko-KR", operation: "mutation" },
  );
  return normalized.verified ? normalized.message : KAKAO_SIGNUP_FAILURE_COPY;
}

export async function completeKakaoOnboarding(input: OnboardingInput) {
  const cookieStore = await cookies();
  const pendingToken = cookieStore.get("pending_kakao_signup")?.value;
  if (!pendingToken) return { success: false, error: "카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요." };

  try {
    const { data } = await serverAPIClient.post("/auth/kakao/complete-signup", input, {
      headers: { "x-pending-signup-token": pendingToken },
    });
    cookieStore.delete("pending_kakao_signup");
    return { success: data.success === true };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) cookieStore.delete("pending_kakao_signup");
    if (!axios.isAxiosError(error)) {
      return { success: false, error: KAKAO_SIGNUP_FAILURE_COPY };
    }
    return {
      success: false,
      error: kakaoSignupFailure(
        error.response?.status ?? 500,
        error.response?.data,
      ),
    };
  }
}
