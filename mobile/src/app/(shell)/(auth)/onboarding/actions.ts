"use server";
import { cookies } from "next/headers";
import axios from "axios";
import { authBirthDateSchema, authPhoneSchema, normalizeApiError } from "@babyjamjam/shared";
import {
  clearPendingAccountOnboarding,
  clearPendingOnboarding,
  PENDING_ACCOUNT_ONBOARDING_COOKIE,
  readPendingAccountAutoLogin,
} from "@/lib/auth/pending-onboarding-cookies";
import { serverAPIClient } from "@/lib/api/server";
import { writeLoginSessionCookies } from "@/lib/auth/login-session-cookies";

const EXPIRED = "로그인 세션이 만료됐어요. 다시 로그인해 주세요.";
export async function completeAccountOnboarding(input: { phone?: string; birthDate?: string }) {
  const store = await cookies();
  const token = store.get(PENDING_ACCOUNT_ONBOARDING_COOKIE)?.value;
  if (!token) {
    clearPendingAccountOnboarding(store);
    return { success: false, error: EXPIRED };
  }
  try {
    const { data } = await serverAPIClient.post("/auth/onboarding/complete", input, {
      headers: { "x-pending-onboarding-token": token },
    });
    if (!data.success || !data.accessToken || !data.refreshToken) return { success: false, error: "계정 정보를 저장하지 못했습니다." };
    await writeLoginSessionCookies(data, readPendingAccountAutoLogin(store, token));
    clearPendingOnboarding(store);
    return { success: true, requiresBranchSelection: Boolean(data.requiresBranchSelection) };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const problem = error.response?.data;
      if (status === 429) {
        const normalized = normalizeApiError({ response: { status, data: problem } }, { locale: "ko-KR", operation: "mutation" });
        return { success: false, error: normalized.verified ? normalized.message : "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." };
      }
      if (status === 401) {
        clearPendingAccountOnboarding(store);
        return { success: false, error: EXPIRED };
      }
      if (status === 403 && ["PENDING_APPROVAL", "ACCOUNT_REJECTED", "NO_ACCESSIBLE_BRANCH"].includes(problem?.code)) {
        return { success: false, authErrorCode: String(problem.code) };
      }
      if (status === 400 && problem?.code === "VALIDATION_FAILED") {
        const fieldError = (problem.errors as { pointer?: string; code?: string }[] | undefined)?.find(e => e.pointer === "/phone" || e.pointer === "/birthDate");
        if (fieldError) {
          const field = fieldError.pointer === "/phone" ? "phone" as const : "birthDate" as const;
          const parsed = (field === "phone" ? authPhoneSchema : authBirthDateSchema).safeParse(input[field] ?? "");
          return { success: false, field, error: field === "phone" && fieldError.code === "INVALID_VALUE"
            ? "이미 등록된 전화번호예요. 오너에게 문의해 주세요."
            : !parsed.success ? parsed.error.issues[0].message : field === "phone" ? "전화번호 형식이 올바르지 않아요. 010-1234-5678처럼 입력해 주세요." : "생년월일 형식이 올바르지 않아요. 1990-01-01처럼 입력해 주세요." };
        }
      }
    }
    return { success: false, error: "계정 정보를 저장하지 못했습니다." };
  }
}
