import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse, withNoStore } from "@/lib/api/route-utils";
import { getServiceRecordAuthorization } from "@/lib/api/service-record-auth";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string; index: string }> }) {
    const { index } = await params;
    const authorization = getServiceRecordAuthorization(request);
    try {
        const response = await serverAPIClient.delete(
            `/service-record/sessions/${encodeURIComponent(index)}`,
            { headers: { Authorization: authorization } },
        );
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "delete service record session");
    }
}
