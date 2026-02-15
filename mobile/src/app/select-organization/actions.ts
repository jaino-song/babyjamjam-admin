"use server";

import { cookies } from "next/headers";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";

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

    const { data } = await serverAPIClient.post("/auth/select-organization", {
      organizationId,
    }, {
      headers: getAuthHeaders(token),
    });

    // Update auth token with new organization context
    cookieStore.set("auth_token", data.accessToken, {
      httpOnly: true,
      secure: isSecureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: data.role === "owner" ? 30 * 24 * 60 * 60 : 3 * 24 * 60 * 60,
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
