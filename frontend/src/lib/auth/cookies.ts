import { jwtDecode } from "jwt-decode";
import { cookies } from "next/headers";
import { cache } from "react";

import { createServerApiUrl } from "@/lib/api/server-base-url";
import type { AuthUser } from "@/hooks/useGetAuthUser";

interface TokenPayload {
  sub: string;
  role: string | null;
  branchId?: string;
  branchRole?: string;
  organizationId?: string;
  orgRole?: string;
  type: "access" | "refresh";
}

type CurrentUserResponse = AuthUser & {
  branchRole?: string | null;
  branchName?: string | null;
  branchSlug?: string | null;
  organizationName?: string | null;
};

const AUTH_ME_TIMEOUT_MS = 60000;
const E2E_AUTH_COOKIE_NAME = "e2e_auth";
const E2E_AUTH_USER: AuthUser = {
  id: "e2e-user",
  name: "E2E Tester",
  email: "e2e@example.com",
  phone: "010-1234-5678",
  birthDate: "1990-01-01",
  profileImage: "",
  role: "admin",
  branchRole: "admin",
  branchName: "테스트 지점",
};

function isServerE2ETestMode(): boolean {
  return process.env["NEXT_PUBLIC_E2E_TEST"] === "true" && process.env["NODE_ENV"] !== "production";
}

/**
 * `/auth/me` could not give a definite answer (timeout, network failure, 5xx,
 * unreadable body). The session is NOT known to be invalid, so callers must not
 * treat this as "signed out": no redirect to /login and no cookie clearing.
 * `getCurrentUser` returns null only when the user is really not authenticated.
 */
export class AuthServiceUnavailableError extends Error {
  constructor(message = "Authentication service is unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthServiceUnavailableError";
  }
}

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// native fetch를 사용하지만 인증 정보는 request cycle 안에서만 재사용한다.
//
// 반환/예외 계약:
// - null: 로그인되지 않음 (auth_token 쿠키 없음, /auth/me 401·403)
// - AuthServiceUnavailableError: 백엔드 응답 불가 (timeout, 네트워크 오류, 5xx 등)
export const getCurrentUser = cache(async () => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    if (!authToken) {
      return null;
    }

    // The hard-coded admin bypass requires BOTH the build-time E2E flag
    // (NEXT_PUBLIC_E2E_TEST=true on a non-production build) AND an explicit
    // per-request cookie. The cookie alone is insufficient — without the
    // build flag, a regular user on a dev/staging deploy could self-elevate
    // to admin by setting one cookie in their browser.
    if (
      isServerE2ETestMode() &&
      cookieStore.get(E2E_AUTH_COOKIE_NAME)?.value === "1"
    ) {
      return E2E_AUTH_USER;
    }

    let res: Response;
    try {
      res = await fetch(createServerApiUrl("/auth/me"), {
        headers: {
          Authorization: `Bearer ${authToken.value}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(AUTH_ME_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new AuthServiceUnavailableError("Failed to reach /auth/me", { cause: error });
    }

    if (res.status === 401 || res.status === 403) {
      return null;
    }

    if (!res.ok) {
      throw new AuthServiceUnavailableError(`Unexpected /auth/me status ${res.status}`);
    }

    let user: CurrentUserResponse;
    try {
      user = (await res.json()) as CurrentUserResponse;
    } catch (error: unknown) {
      throw new AuthServiceUnavailableError("Unreadable /auth/me response", { cause: error });
    }

    return {
      ...user,
      branchName: user.branchName ?? user.organizationName ?? null,
      branchSlug: user.branchSlug ?? null,
    };
  } catch (error: unknown) {
    if (error instanceof AuthServiceUnavailableError) {
      console.error("[getCurrentUser] Auth service unavailable:", error.message, {
        cause: error.cause instanceof Error ? error.cause.message : undefined,
      });
      throw error;
    }
    if (error instanceof Error) {
      console.error("[getCurrentUser] Failed to fetch user:", error.message);
    } else {
      console.error("[getCurrentUser] Failed to fetch user:", String(error));
    }
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
