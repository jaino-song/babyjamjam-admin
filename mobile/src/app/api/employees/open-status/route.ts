import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse, parseBody } from "@/lib/api/route-utils";

// Mirrors backend ChangeEmployeeOpenStatusDto: openToNextWork (@IsBoolean,
// no @IsOptional) is required. Passthrough preserves any forward-compatible
// fields for the backend's authoritative ValidationPipe.
const changeOpenStatusSchema = z
    .object({
        openToNextWork: z.boolean(),
    })
    .passthrough();

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function PATCH(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");

    if (!id) {
        return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
    }

    const { data, response: invalid } = await parseBody(changeOpenStatusSchema, request);
    if (invalid) {
        return invalid;
    }

    try {
        const response = await serverAPIClient.patch("/employees/open-status", data, {
            params: { id },
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "update employee open status");
    }
}
