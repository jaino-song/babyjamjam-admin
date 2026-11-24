"use server";

import { cookies } from "next/headers";
import axios from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { ACCOUNT_LINK_VERSION, ACCOUNT_LINK_VERSION_HEADER, normalizeApiError } from "@babyjamjam/shared";

interface OnboardingInput {
  phone: string;
  birthDate: string;
  role: string;
}

// Locally authored failure copy — upstream body messages are never forwarded
// to the client flow.
const KAKAO_SIGNUP_FAILURE_COPY = "카카오 가입을 완료하지 못했습니다. 다시 시도해 주세요.";

function kakaoSignupFailure(status: number, data: unknown): { error: string; field?: "phone" | "birthDate" } {
  const problem = data as { code?: string; errors?: { pointer?: string; code?: string }[] } | undefined;
  if (status === 401 && problem?.code === "AUTH_REQUIRED") return { error: "카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요." };
  if (status === 400 && problem?.code === "VALIDATION_FAILED") {
    const field = problem.errors?.find(e => ["/phone", "/birthDate", "/code"].includes(e.pointer ?? ""));
    if (field?.pointer === "/code") return { error: "인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요." };
    if (field?.pointer === "/phone") return { field: "phone", error: field.code === "INVALID_VALUE" ? "이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요." : "전화번호 형식이 올바르지 않아요. 010-1234-5678처럼 입력해 주세요." };
    if (field?.pointer === "/birthDate") return { field: "birthDate", error: "생년월일 형식이 올바르지 않아요. 1990-01-01처럼 입력해 주세요." };
  }
  if (status === 429) {
    const normalized = normalizeApiError({ response: { status, data } }, { locale: "ko-KR", operation: "mutation" });
    return { error: normalized.verified ? normalized.message : "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." };
  }
  return { error: KAKAO_SIGNUP_FAILURE_COPY };
}

export async function completeKakaoOnboarding(
  input: OnboardingInput,
  accountLinkVersion?: string,
): Promise<{ success: boolean; code?: "LINK_PENDING_APPROVAL"; error?: string; field?: "phone" | "birthDate"; linkVerificationRequired?: boolean; linkChallengeToken?: string }> {
  const cookieStore = await cookies();
  const pendingToken = cookieStore.get("pending_kakao_signup")?.value;
  if (!pendingToken) return { success: false, error: "카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요." };

  const supportsAccountLink = accountLinkVersion === ACCOUNT_LINK_VERSION;
  try {
    const { data } = await serverAPIClient.post("/auth/kakao/complete-signup", input, {
      headers: {
        "x-pending-signup-token": pendingToken,
        ...(supportsAccountLink ? { [ACCOUNT_LINK_VERSION_HEADER]: ACCOUNT_LINK_VERSION } : {}),
      },
    });
    if (data.linkVerificationRequired === true) {
      return supportsAccountLink && typeof data.linkChallengeToken === "string" && data.linkChallengeToken
        ? { success: true, linkVerificationRequired: true, linkChallengeToken: data.linkChallengeToken }
        : { success: false, error: KAKAO_SIGNUP_FAILURE_COPY };
    }
    cookieStore.delete("pending_kakao_signup");
    return { success: data.success === true };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 401) cookieStore.delete("pending_kakao_signup");
    if (!axios.isAxiosError(error)) {
      return { success: false, error: KAKAO_SIGNUP_FAILURE_COPY };
    }
    if (error.response?.status === 403 && error.response.data?.code === "PENDING_APPROVAL") {
      return { success: false, code: "LINK_PENDING_APPROVAL" };
    }
    return {
      success: false,
      ...kakaoSignupFailure(
        error.response?.status ?? 500,
        error.response?.data,
      ),
    };
  }
}

export async function verifyKakaoLink(challengeToken: string, code: string): Promise<{ success: boolean; error?: string }> {
  const store = await cookies();
  const token = store.get("pending_kakao_signup")?.value;
  if (!token) return { success: false, error: "카카오 가입 세션이 만료됐어요. 다시 로그인해 주세요." };
  try {
    const { data } = await serverAPIClient.post("/auth/kakao/link/verify", { challengeToken, code }, { headers: { "x-pending-signup-token": token } });
    if (data.success === true && data.linked === true) { store.delete("pending_kakao_signup"); return { success: true }; }
    return { success: false, error: KAKAO_SIGNUP_FAILURE_COPY };
  } catch (error) {
    if (!axios.isAxiosError(error)) return { success: false, error: KAKAO_SIGNUP_FAILURE_COPY };
    if (error.response?.status === 401) store.delete("pending_kakao_signup");
    return { success: false, ...kakaoSignupFailure(error.response?.status ?? 500, error.response?.data) };
  }
}
