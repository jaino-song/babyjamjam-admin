"use server";

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";

export async function logout(): Promise<{ success: boolean; error?: string }> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    // Call backend to clear server-side cookies
    if (token) {
      try {
        await serverAPIClient.post("/auth/logout", {}, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore backend errors - we'll clear cookies anyway
      }
    }

    // Clear all auth-related cookies
    cookieStore.delete("auth_token");
    cookieStore.delete("refresh_token");
    cookieStore.delete("selected_organization_id");

    return { success: true };
  } catch (error) {
    console.error("[Logout] Error:", error);
    return { success: false, error: "로그아웃 중 오류가 발생했습니다." };
  }
}
