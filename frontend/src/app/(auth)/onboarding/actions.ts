"use server";

import { cookies } from "next/headers";
import { AxiosError } from "axios";
import { normalizeApiError } from "@babyjamjam/shared";
import {
  clearPendingAccountOnboarding,
  clearPendingOnboarding,
  PENDING_ACCOUNT_ONBOARDING_COOKIE,
  readPendingAccountAutoLogin,
} from "@/lib/auth/pending-onboarding-cookies";
import { serverAPIClient } from "@/lib/api/server";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { getFieldMessageText } from "@/lib/forms/field-message-text";

interface CompletionResult {
  success: boolean;
  error?: string;
  field?: "phone" | "birthDate";
  code?: string;
  requiresBranchSelection?: boolean;
}
const EXPIRED = "로그인 세션이 만료됐어요. 다시 로그인해 주세요.";

export async function completeAccountOnboarding(input: { phone?: string; birthDate?: string }): Promise<CompletionResult> {
  const store = await cookies();
  const token = store.get(PENDING_ACCOUNT_ONBOARDING_COOKIE)?.value;
  if (!token) {
    clearPendingAccountOnboarding(store);
    return { success: false, error: EXPIRED };
  }
  try {
    const { data } = await serverAPIClient.post<{ accessToken: string; refreshToken: string; requiresBranchSelection?: boolean }>("/auth/onboarding/complete", input, {
      headers: { "x-pending-onboarding-token": token },
    });
    setAuthSessionCookies(store, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      autoLogin: readPendingAccountAutoLogin(store, token),
    });
    clearPendingOnboarding(store);
    return { success: true, requiresBranchSelection: Boolean(data.requiresBranchSelection) };
  } catch (error) {
    const response = error instanceof AxiosError ? error.response : undefined;
    const status = response?.status;
    const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
    if (status === 401) {
      clearPendingAccountOnboarding(store);
      return { success: false, error: EXPIRED };
    }
    if (status === 403 && response?.data?.code === "ACCOUNT_PROFILE_INCOMPLETE") {
      return { success: false, code: "ACCOUNT_PROFILE_INCOMPLETE" };
    }
    const problem = normalized.problem;
    if (status === 403 && problem && ["PENDING_APPROVAL", "ACCOUNT_REJECTED", "NO_ACCESSIBLE_BRANCH"].includes(problem.code)) {
      return { success: false, code: problem.code };
    }
    if (status === 400 && problem?.code === "VALIDATION_FAILED") {
      const issue = problem.errors?.find((item) => item.pointer === "/phone" || item.pointer === "/birthDate");
      if (issue) {
        const field = issue.pointer === "/phone" ? "phone" : "birthDate";
        return { success: false, field, error: field === "phone" && issue.code === "INVALID_VALUE"
          ? "이미 등록된 전화번호예요. 오너에게 문의해 주세요."
          : getFieldMessageText("ko", {
            tone: "error",
            code: issue.code === "REQUIRED" ? "required" : field === "phone" ? "phone-format" : "date-format",
          }, field === "phone" ? "전화번호" : "생년월일") };
      }
    }
    return { success: false, error: status === 429
      ? normalized.verified ? normalized.message : "요청이 너무 많아요. 잠시 후 다시 시도해 주세요."
      : "계정 정보를 저장하지 못했습니다." };
  }
}
