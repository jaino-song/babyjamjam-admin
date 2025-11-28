import { serverAPIClient } from "@/app/lib/axios/server";
import { cookies } from "next/headers";

export async function getCurrentUser() {
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
}