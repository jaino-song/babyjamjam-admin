"use server";

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";

interface Organization {
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

export async function getUserOrganizations(): Promise<{
  success: boolean;
  organizations?: Organization[];
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value || null;

    const { data } = await serverAPIClient.get("/auth/organizations", {
      headers: getAuthHeaders(token),
    });

    return {
      success: true,
      organizations: data.organizations,
    };
  } catch (error) {
    console.error("[Server Action] Error fetching organizations:", error);

    if (error instanceof AxiosError) {
      const axiosError = error as AxiosError<APIErrorResponse>;
      return {
        success: false,
        error: axiosError.response?.data?.message || "조직 목록을 불러오는데 실패했습니다.",
      };
    }

    return {
      success: false,
      error: "조직 목록을 불러오는데 실패했습니다.",
    };
  }
}

export async function setCurrentOrganization(organizationId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const isSecureCookie = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
    const token = cookieStore.get("auth_token")?.value || null;
    const autoLoginCookie = cookieStore.get("auto_login")?.value;
    const autoLogin = autoLoginCookie !== "0" && autoLoginCookie !== "false";

    const { data } = await serverAPIClient.post("/auth/select-organization", {
      organizationId,
    }, {
      headers: getAuthHeaders(token),
    });

    setAuthSessionCookies(cookieStore, {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      autoLogin,
    });

    // Store selected organization ID in a separate cookie for client-side access
    cookieStore.set("selected_organization_id", organizationId, {
      httpOnly: false,
      secure: isSecureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });

    return { success: true };
  } catch (error) {
    console.error("[Server Action] Error setting current organization:", error);

    if (error instanceof AxiosError) {
      const axiosError = error as AxiosError<APIErrorResponse>;
      return {
        success: false,
        error: axiosError.response?.data?.message || "조직 선택에 실패했습니다.",
      };
    }

    return {
      success: false,
      error: "조직 선택에 실패했습니다.",
    };
  }
}
