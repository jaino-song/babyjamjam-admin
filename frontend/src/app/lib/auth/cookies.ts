import { serverAPIClient } from "@/app/lib/axios/server";
import { cookies } from "next/headers";
import { cache } from "react";
import { jwtDecode } from "jwt-decode";

interface TokenPayload {
  sub: string;
  role: string | null;
  organizationId?: string;
  orgRole?: string;
  type: "access" | "refresh";
}

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// Next.js의 Request Memoization은 native fetch에만 적용되므로
// axios를 사용하는 경우 수동으로 캐싱 필요
export const getCurrentUser = cache(async () => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    console.log("[getCurrentUser] auth_token present:", !!authToken);

    if (!authToken) {
      console.log("[getCurrentUser] No auth token found");
      return null;
    }

    // Send token as Bearer token in Authorization header
    const { data } = await serverAPIClient.get(`/auth/me`, {
      headers: {
        Authorization: `Bearer ${authToken.value}`,
      },
    });

    console.log("[getCurrentUser] User fetched successfully:", data?.name);
    return data;
  } catch (error: any) {
    console.error('[getCurrentUser] Failed to fetch user:', error.message);
    console.error('[getCurrentUser] Error status:', error.response?.status);
    console.error('[getCurrentUser] Error data:', error.response?.data);
    return null;
  }
});

/**
 * Check if user has selected an organization
 * Returns true if organizationId exists in JWT token
 */
export const hasSelectedOrganization = cache(async (): Promise<boolean> => {
  try {
    const cookieStore = await cookies();
    const authToken = cookieStore.get('auth_token');

    if (!authToken) {
      return false;
    }

    const decoded = jwtDecode<TokenPayload>(authToken.value);
    return !!decoded.organizationId;
  } catch {
    return false;
  }
});