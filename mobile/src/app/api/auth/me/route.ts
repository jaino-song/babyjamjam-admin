import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { E2E_ROLE_COOKIE, getE2EAuthUser, isE2ETest } from "@/lib/e2e";
import { errorResponse, getAuthToken } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

export async function GET(request: NextRequest) {
    try {
        if (isE2ETest()) {
            return NextResponse.json(getE2EAuthUser(request.cookies.get(E2E_ROLE_COOKIE)?.value));
        }

        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const response = await serverAPIClient.get("/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
        });

        return NextResponse.json(response.data);
    } catch (error: unknown) {
        return errorResponse(error, "fetch user", "read");
    }
}
