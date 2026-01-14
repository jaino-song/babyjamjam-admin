import { serverAPIClient } from "@/app/lib/axios/server";
import { cookies } from "next/headers";
import { cache } from "react";

// Development/Preview 환경에서 사용할 Mock User
const DEV_MOCK_USER = {
  id: 'dev-user',
  name: '개발자',
  email: 'dev@example.com',
  profile_image: null,
};

// React cache()를 사용하여 같은 request cycle 내에서 중복 호출 방지
// Next.js의 Request Memoization은 native fetch에만 적용되므로
// axios를 사용하는 경우 수동으로 캐싱 필요
export const getCurrentUser = cache(async () => {
  try {
    // Development 또는 Vercel Preview 환경에서는 인증을 bypass
    if (process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'preview') {
      console.log("[getCurrentUser] Dev/Preview mode - bypassing auth");
      return DEV_MOCK_USER;
    }

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