import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { getServiceRecordAuthorization } from "@/lib/api/service-record-auth";

// Guarded by the minted access token from the path-scoped HttpOnly cookie.
export async function POST(request: NextRequest) {
    const authorization = getServiceRecordAuthorization(request);
    try {
        const response = await serverAPIClient.post("/service-record/schedule-change", {}, {
            headers: { Authorization: authorization },
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "schedule-change request");
    }
}
