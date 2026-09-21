"use server";

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { clearAuthSessionCookies } from "@/lib/auth/session-cookies";
import { normalizeApiError } from "@babyjamjam/shared";

export async function logout(pushEndpoint?: string): Promise<{ success: boolean; error?: string }> {
  let serverLogoutError: string | undefined;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const refreshToken = cookieStore.get("refresh_token")?.value;

    if (token || refreshToken) {
      try {
        await serverAPIClient.post("/auth/logout", {
          refreshToken,
          ...(pushEndpoint ? { pushEndpoint } : {}),
        }, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      } catch (logoutError) {
        // Local cookies are still cleared below, but report the server failure
        // so callers do not claim that the session was fully revoked. A
        // registered problem body drives the copy; the local fallback stays.
        let message: string | null = null;
        if (logoutError && typeof logoutError === "object" && "isAxiosError" in logoutError) {
          const axiosError = logoutError as { response?: { status?: number; data?: unknown } };
          if (axiosError.response) {
            const normalized = normalizeApiError(
              { response: { status: axiosError.response.status ?? 500, data: axiosError.response.data } },
              { locale: "ko-KR", operation: "mutation" },
            );
            if (normalized.verified) message = normalized.message;
          }
        }
        serverLogoutError = message ?? "서버 로그아웃에 실패했어요. 다시 시도해 주세요.";
      }
    }

    clearAuthSessionCookies(cookieStore);
    cookieStore.delete("selected_branch_id");
    cookieStore.delete("selected_organization_id");

    return serverLogoutError
      ? { success: false, error: serverLogoutError }
      : { success: true };
  } catch (error) {
    console.error("[Logout] Error:", error);
    return { success: false, error: "로그아웃 중 오류가 발생했어요." };
  }
}
