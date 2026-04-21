"use server";

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

interface Branch {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: string;
}

interface APIErrorResponse {
  statusCode: number;
  message: string;
  error: string;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getUserBranches(): Promise<{
  success: boolean;
  branches?: Branch[];
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value || null;

    const { data } = await serverAPIClient.get("/auth/branches", {
      headers: getAuthHeaders(token),
    });

    return {
      success: true,
      branches: data.branches,
    };
  } catch (error) {
    console.error("[Server Action] Error fetching branches:", error);

    if (error instanceof AxiosError) {
      const axiosError = error as AxiosError<APIErrorResponse>;
      return {
        success: false,
        error: axiosError.response?.data?.message || "지점 목록을 불러오는데 실패했습니다.",
      };
    }

    return {
      success: false,
      error: "지점 목록을 불러오는데 실패했습니다.",
    };
  }
}

export async function setCurrentBranch(branchId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
    const token = cookieStore.get("auth_token")?.value || null;
    const autoLoginCookie = cookieStore.get("auto_login")?.value;
    const autoLogin = autoLoginCookie !== "0" && autoLoginCookie !== "false";

    const { data } = await serverAPIClient.post("/auth/select-branch", {
      branchId,
    }, {
      headers: getAuthHeaders(token),
    });

    setAuthSessionCookies(cookieStore, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      autoLogin,
    });

    cookieStore.set("selected_branch_id", branchId, {
      httpOnly: false,
      secure: isSecureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    return { success: true };
  } catch (error) {
    console.error("[Server Action] Error setting current branch:", error);

    if (error instanceof AxiosError) {
      const axiosError = error as AxiosError<APIErrorResponse>;
      return {
        success: false,
        error: axiosError.response?.data?.message || "지점 선택에 실패했습니다.",
      };
    }

    return {
      success: false,
      error: "지점 선택에 실패했습니다.",
    };
  }
}
