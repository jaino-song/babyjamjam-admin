import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { getServiceRecordAuthorization } from "@/lib/api/service-record-auth";

// Guarded by the minted access token from the path-scoped HttpOnly cookie.
// The branch comes from the token context on the backend; only `year` is forwarded.
export async function GET(request: NextRequest) {
    const authorization = getServiceRecordAuthorization(request);
    const year = request.nextUrl.searchParams.get("year");
    try {
        const response = await serverAPIClient.get("/service-record/holidays", {
            headers: { Authorization: authorization },
            ...(year !== null ? { params: { year } } : {}),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "service record holidays");
    }
}
