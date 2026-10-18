import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import { invalidEmployeeIdResponse, isValidEmployeeId } from "../employee-route-utils";

// GET /api/employees/id?id=12 - Look up one employee of the caller's branch.
// The backend answers an unknown or other-branch id with an empty 200 body, so
// that body is passed through unchanged: callers must treat anything that is
// not a record with the requested id as "not found".
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const id = request.nextUrl.searchParams.get("id");
        if (!isValidEmployeeId(id)) {
            return invalidEmployeeIdResponse();
        }

        const response = await serverAPIClient.get("/employees/id", {
            params: { id },
            headers: getAuthHeaders(token),
        });

        return NextResponse.json(response.data ?? null);
    } catch (error) {
        return errorResponse(error, "fetch employee");
    }
}
