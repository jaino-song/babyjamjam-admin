import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { invalidEmployeeIdResponse, isValidEmployeeId } from "../../employee-route-utils";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { id } = await context.params;
    if (!isValidEmployeeId(id)) {
        return invalidEmployeeIdResponse();
    }

    try {
        const response = await serverAPIClient.get(`/employees/${id}/active-clients`, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch employee active clients");
    }
}
