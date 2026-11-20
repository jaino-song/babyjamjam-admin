"use server";

import { cookies } from "next/headers";
import { AxiosError } from "axios";
import { normalizeApiError } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

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
  const token = store.get("pending_account_onboarding")?.value;
  if (!token) return { success: false, error: EXPIRED };
  try {
    const { data } = await serverAPIClient.post<{ accessToken: string; refreshToken: string; requiresBranchSelection?: boolean }>("/auth/onboarding/complete", input, {
      headers: { "x-pending-onboarding-token": token },
    });
    setAuthSessionCookies(store, { accessToken: data.accessToken, refreshToken: data.refreshToken });
    store.delete("pending_account_onboarding");
    store.delete("pending_kakao_signup");
    return { success: true, requiresBranchSelection: Boolean(data.requiresBranchSelection) };
  } catch (error) {
    const status = error instanceof AxiosError ? error.response?.status : undefined;
    const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
    if (status === 401) {
      store.delete("pending_account_onboarding");
      return { success: false, error: EXPIRED };
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
          : field === "phone" ? "전화번호 11자리를 입력해 주세요." : "올바른 생년월일을 입력해 주세요." };
      }
    }
    return { success: false, error: "계정 정보를 저장하지 못했습니다." };
  }
}
