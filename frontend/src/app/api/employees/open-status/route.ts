import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

export async function PATCH(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
        }

        const body = await request.json();
        const response = await serverAPIClient.patch("/employees/open-status", body, {
            params: { id },
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "update employee open status");
    }
}
