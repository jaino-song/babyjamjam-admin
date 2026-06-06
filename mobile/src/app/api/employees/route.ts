import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

function isValidEmployeeId(id: string | null): id is string {
    return Boolean(id && /^[1-9]\d*$/.test(id));
}

function invalidEmployeeIdResponse(): NextResponse {
    return NextResponse.json({ error: "Invalid employee id" }, { status: 400 });
}

// GET /api/employees - Get all employees
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const response = await serverAPIClient.get("/employees", {
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch employees");
    }
}

// POST /api/employees - Create a new employee
export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.post("/employees", body, {
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "create employee");
    }
}

// PATCH /api/employees?id=X - Update an employee
export async function PATCH(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { error: "Employee ID is required" },
                { status: 400 }
            );
        }

        if (!isValidEmployeeId(id)) {
            return invalidEmployeeIdResponse();
        }

        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.patch("/employees", body, {
            params: { id },
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "update employee");
    }
}

// DELETE /api/employees?id=X - Delete an employee
export async function DELETE(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const id = searchParams.get("id");

        if (!id) {
            return NextResponse.json(
                { error: "Employee ID is required" },
                { status: 400 }
            );
        }

        if (!isValidEmployeeId(id)) {
            return invalidEmployeeIdResponse();
        }

        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const response = await serverAPIClient.delete("/employees", {
            params: { id },
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "delete employee");
    }
}
