import axios from "axios";
import { cookies } from "next/headers";
import { cache } from "react";

import type { AuthUser } from "@/app/hooks/useGetAuthUser";
import { serverAPIClient } from "@/app/lib/axios/server";

const LEGACY_DEMO_USER: AuthUser = {
  id: "legacy-demo",
  name: "Legacy Demo",
};

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// Next.js의 Request Memoization은 native fetch에만 적용되므로
// axios를 사용하는 경우 수동으로 캐싱 필요
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  if (process.env.LEGACY_DEMO_MODE === "true") {
    return LEGACY_DEMO_USER;
  }

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";

    console.error('[getCurrentUser] Failed to fetch user:', message);

    if (axios.isAxiosError(error)) {
      console.error('[getCurrentUser] Error status:', error.response?.status);
      console.error('[getCurrentUser] Error data:', error.response?.data);
    }

    return null;
  }
});
