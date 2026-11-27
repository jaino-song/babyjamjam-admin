import type { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { getAuthHeaders } from "@/lib/api/route-utils";

import { REGISTRATION_BRANCH_HEADER, REGISTRATION_USER_HEADER } from "./registration-scope";

export async function matchesRegistrationScope(request: NextRequest, token: string): Promise<boolean> {
    const branchId = request.headers.get(REGISTRATION_BRANCH_HEADER);
    const userId = request.headers.get(REGISTRATION_USER_HEADER);
    if (branchId === null && userId === null) return true;
    if (!branchId || !userId || request.cookies.get("selected_branch_id")?.value.trim()
        || request.cookies.get("selected_organization_id")?.value.trim()) return false;

    // Check the exact bearer that will be forwarded, including after an API retry.
    const { data, status } = await serverAPIClient.get<{ id?: string; branchId?: string } | null>("/auth/me", {
        headers: getAuthHeaders(token),
    });
    return status === 200 && data?.id === userId && data.branchId === branchId;
}
