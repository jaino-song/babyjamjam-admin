"use server";

import { cookies } from "next/headers";
import axios from "axios";

import { serverAPIClient } from "@/lib/api/server";

interface OnboardingInput {
  phone: string;
  birthDate: string;
  role: string;
}

export async function completeKakaoOnboarding(input: OnboardingInput) {
  const cookieStore = await cookies();
  const pendingToken = cookieStore.get("pending_kakao_signup")?.value;
  if (!pendingToken) return { success: false, error: "카카오 가입 세션이 만료되었습니다. 다시 로그인해 주세요." };

  try {
    const { data } = await serverAPIClient.post("/auth/kakao/complete-signup", input, {
      headers: { "x-pending-signup-token": pendingToken },
    });
    cookieStore.delete("pending_kakao_signup");
    return { success: data.success === true };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) cookieStore.delete("pending_kakao_signup");
    return {
      success: false,
      error: axios.isAxiosError(error)
        ? error.response?.data?.message || "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요."
        : "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.",
    };
  }
}
