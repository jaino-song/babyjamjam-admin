import { serverAPIClient } from "@/lib/api/server";
import { cookies } from "next/headers";
import { cache } from "react";
import { jwtDecode } from "jwt-decode";
import axios from "axios";
import { E2E_ROLE_COOKIE, getE2EAuthUser, isE2ETest } from "@/lib/e2e";
import type { AuthUser } from "@/hooks/useGetAuthUser";

interface TokenPayload {
  sub: string;
  role: string | null;
  branchId?: string;
  branchRole?: string;
  organizationId?: string;
  type: "access" | "refresh";
}

type CurrentUserResponse = AuthUser & {
  branchRole?: string | null;
};

/**
 * `/auth/me` could not give a definite answer (timeout, network failure, 5xx,
 * redirect, unreadable body). The session is NOT known to be invalid, so callers
 * must not treat this as "signed out": no redirect to /login and no cookie
 * clearing. `getCurrentUser` returns null only when the user is really not
 * authenticated.
 */
export class AuthServiceUnavailableError extends Error {
  constructor(message = "Authentication service is unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthServiceUnavailableError";
  }
}

function logFetchFailure(error: unknown): void {
  if (axios.isAxiosError(error)) {
    console.error("[getCurrentUser] Failed to fetch user:", {
      code: error.code,
      status: error.response?.status,
      name: error.name,
    });
  } else if (error instanceof Error) {
    console.error("[getCurrentUser] Failed to fetch user:", { name: error.name });
  } else {
    console.error("[getCurrentUser] Failed to fetch user");
  }
}

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// Next.js의 Request Memoization은 native fetch에만 적용되므로
// axios를 사용하는 경우 수동으로 캐싱 필요
//
// 반환/예외 계약:
// - null: 로그인되지 않음 (auth_token 쿠키 없음, /auth/me 401·403)
// - AuthServiceUnavailableError: 백엔드 응답 불가 (timeout, 네트워크 오류, 5xx, 3xx, 본문 이상)
export const getCurrentUser = cache(async () => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    console.log("[getCurrentUser] auth_token present:", !!authToken);

    if (!authToken) {
      console.log("[getCurrentUser] No auth token found");
      return null;
    }

    if (isE2ETest()) {
      return getE2EAuthUser(cookieStore.get(E2E_ROLE_COOKIE)?.value);
    }

    let res;
    try {
      // Send token as Bearer token in Authorization header
      res = await serverAPIClient.get(`/auth/me`, {
        headers: {
          Authorization: `Bearer ${authToken.value}`,
        },
      });
    } catch (error: unknown) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status === 401 || status === 403) {
        return null;
      }
      logFetchFailure(error);
      throw new AuthServiceUnavailableError("Failed to reach /auth/me", { cause: error });
    }

    // serverAPIClient accepts every status below 400, so a 3xx (or any other
    // non-200 success-range status) lands here and is not a valid session answer.
    if (res.status !== 200 || !res.data || typeof res.data !== "object") {
      console.error("[getCurrentUser] Unexpected /auth/me response", { status: res.status });
      throw new AuthServiceUnavailableError(`Unexpected /auth/me response (status ${res.status})`);
    }

    console.log("[getCurrentUser] User fetched successfully:", res.data?.name);
    return res.data as CurrentUserResponse;
  } catch (error: unknown) {
    if (error instanceof AuthServiceUnavailableError) {
      throw error;
    }
    logFetchFailure(error);
    return null;
  }
});

/**
 * For "is someone already signed in?" checks (login/onboarding entry points).
 * An unavailable backend behaves like the signed-out branch instead of crashing
 * the page, so a user can still reach the login screen while the API is down.
 */
export async function getOptionalCurrentUser() {
  try {
    return await getCurrentUser();
  } catch (error: unknown) {
    if (error instanceof AuthServiceUnavailableError) {
      return null;
    }
    throw error;
  }
}

/**
 * Check if user has selected an branch
 * Returns true if branchId exists in JWT token
 */
export const hasSelectedBranch = cache(async (): Promise<boolean> => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    if (!authToken) {
      return false;
    }

    const decoded = jwtDecode<TokenPayload>(authToken.value);
    return !!(decoded.branchId ?? decoded.organizationId);
  } catch {
    return false;
  }
});
