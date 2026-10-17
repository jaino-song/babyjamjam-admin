import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken, unauthorizedResponse } from "@/lib/api/route-utils";
import { invalidEmployeeIdResponse, isValidEmployeeId } from "../employee-route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");
        const id = request.nextUrl.searchParams.get("id");
        if (!isValidEmployeeId(id)) return invalidEmployeeIdResponse();
        const response = await serverAPIClient.get("/employees/id", {
            headers: getAuthHeaders(token),
            params: { id },
        });
        return NextResponse.json(response.data || null);
    } catch (error) {
        return errorResponse(error, "get employee by id");
    }
}
