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
  organizationName?: string | null;
};

const AUTH_ME_TIMEOUT_MS = 60000;

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// native fetch를 사용하지만 인증 정보는 request cycle 안에서만 재사용한다.
export const getCurrentUser = cache(async () => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    if (!authToken) {
      return null;
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
