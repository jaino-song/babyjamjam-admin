"use server";

import { cookies } from "next/headers";
import { AxiosError } from "axios";

import { serverAPIClient } from "@/lib/api/server";
import { setAuthSessionCookies } from "@/lib/auth/session-cookies";
import { normalizeApiError } from "@babyjamjam/shared";

import { prioritizeRecentBranch } from "./branch-order";

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

// Locally authored failure copy — upstream body messages are never forwarded.
const BRANCH_LOAD_FAILURE_COPY = "지점 목록을 불러오는데 실패했어요.";
const BRANCH_SELECT_FAILURE_COPY = "지점 선택에 실패했어요.";

function apiFailureCopy(status: number, data: unknown, fallback: string): string {
  const normalized = normalizeApiError(
    { response: { status, data } },
    { locale: "ko-KR", operation: "mutation" },
  );
  return normalized.verified ? normalized.message : fallback;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeBranchRecord(record: Partial<Branch>): Branch {
  return {
    id: record.id ?? "",
    name: record.name ?? "",
    slug: record.slug ?? record.id ?? "",
    description: record.description ?? null,
    role: record.role ?? "member",
  };
}

export async function getUserBranches(): Promise<{
  success: boolean;
  branches?: Branch[];
  error?: string;
}> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value || null;
    const recentBranchId = cookieStore.get("selected_branch_id")?.value;

    const response = await serverAPIClient.get("/auth/branches", {
      headers: getAuthHeaders(token),
    });

    if (response.status === 404) {
      const { data } = await serverAPIClient.get("/auth/organizations", {
        headers: getAuthHeaders(token),
      });

      return {
        success: true,
        branches: prioritizeRecentBranch(
          (data.organizations ?? []).map((organization: Partial<Branch>) =>
            normalizeBranchRecord(organization)
          ),
          recentBranchId,
        ),
      };
    }

    if (response.status >= 400) {
      return { success: false, error: apiFailureCopy(response.status, response.data, BRANCH_LOAD_FAILURE_COPY) };
    }

    return {
      success: true,
      branches: prioritizeRecentBranch(
        (response.data.branches ?? []).map((branch: Partial<Branch>) =>
          normalizeBranchRecord(branch)
        ),
        recentBranchId,
      ),
    };
  } catch (error) {
    console.error("[Server Action] Error fetching branches:", error);

    if (error instanceof AxiosError) {
      const axiosError = error as AxiosError<APIErrorResponse>;
      return {
        success: false,
        error: apiFailureCopy(
          axiosError.response?.status ?? 500,
          axiosError.response?.data,
          BRANCH_LOAD_FAILURE_COPY,
        ),
      };
    }

    return {
      success: false,
      error: BRANCH_LOAD_FAILURE_COPY,
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

    let response = await serverAPIClient.post("/auth/select-branch", {
      branchId,
    }, {
      headers: getAuthHeaders(token),
    });

    if (response.status === 404 || response.status === 400) {
      response = await serverAPIClient.post("/auth/select-organization", {
        organizationId: branchId,
      }, {
        headers: getAuthHeaders(token),
      });
    }

    if (response.status >= 400) {
      return { success: false, error: apiFailureCopy(response.status, response.data, BRANCH_SELECT_FAILURE_COPY) };
    }

    const { data } = response;

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
    cookieStore.set("selected_organization_id", branchId, {
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
        error: apiFailureCopy(
          axiosError.response?.status ?? 500,
          axiosError.response?.data,
          BRANCH_SELECT_FAILURE_COPY,
        ),
      };
    }

    return {
      success: false,
      error: BRANCH_SELECT_FAILURE_COPY,
    };
  }
}
