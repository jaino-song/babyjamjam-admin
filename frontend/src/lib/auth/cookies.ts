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
  branchName: "테스트 지점",
};

function isServerE2ETestMode(): boolean {
  return process.env["NEXT_PUBLIC_E2E_TEST"] === "true" && process.env["NODE_ENV"] !== "production";
}

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// native fetch를 사용하지만 인증 정보는 request cycle 안에서만 재사용한다.
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

    const res = await fetch(createServerApiUrl("/auth/me"), {
      headers: {
        Authorization: `Bearer ${authToken.value}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(AUTH_ME_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("[getCurrentUser] Failed to fetch user: non-200 response", res.status);
      return null;
    }

    const user = (await res.json()) as CurrentUserResponse;
    return {
      ...user,
      branchName: user.branchName ?? user.organizationName ?? null,
      branchSlug: user.branchSlug ?? null,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("[getCurrentUser] Failed to fetch user:", error.message);
    } else {
      console.error("[getCurrentUser] Failed to fetch user:", String(error));
    }
    return null;
  }
});

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
