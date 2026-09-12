import { NextRequest, NextResponse } from "next/server";
import { getConflictPayload } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import {
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import { invalidEmployeeIdResponse, isValidEmployeeId } from "./employee-route-utils";

// A converted problem body must keep its public `code`; the legacy conflict
// bridge only carries message/clientId, so registered problems fall through
// to the contract-preserving errorResponse passthrough instead.
function hasUpstreamProblemCode(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const payload = (error as { response?: { data?: unknown } }).response?.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    return typeof (payload as { code?: unknown }).code === "string";
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

        // Check if backend returned an error status
        if (response.status >= 400) {
            console.error("[API] Backend error fetching employees:", response.data);
            return NextResponse.json(
                { error: response.data?.message || "Failed to fetch employees" },
                { status: response.status }
            );
        }

        return NextResponse.json(response.data);
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

        const body = await request.json();
        const response = await serverAPIClient.post("/employees", body, {
            headers: getAuthHeaders(token),
        });

        // Check if backend returned an error status
        if (response.status >= 400) {
            console.error("[API] Backend error creating employee:", response.data);
            // Pass through the backend response as-is for consistent error structure
            return NextResponse.json(response.data, { status: response.status });
        }

        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        return errorResponse(error, "create employee");
    }
}

// PATCH /api/employees?id=X - Update an employee
export async function PATCH(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

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

        const body = await request.json();
        const response = await serverAPIClient.patch("/employees", body, {
            params: { id },
            headers: getAuthHeaders(token),
        });

        // Check if backend returned an error status
        if (response.status >= 400) {
            console.error("[API] Backend error updating employee:", response.data);
            return NextResponse.json(response.data, { status: response.status });
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "update employee");
    }
}

// DELETE /api/employees?id=X - Delete an employee
export async function DELETE(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

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

        const response = await serverAPIClient.delete("/employees", {
            params: { id },
            headers: getAuthHeaders(token),
        });

        // Check if backend returned an error status
        if (response.status >= 400) {
            console.error("[API] Backend error deleting employee:", response.data);
            return NextResponse.json(
                { error: response.data?.message || "Failed to delete employee" },
                { status: response.status }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        if (!hasUpstreamProblemCode(error)) {
            const conflict = getConflictPayload(error);
            if (conflict) {
                return NextResponse.json(conflict, { status: 409 });
            }
        }
        return errorResponse(error, "delete employee");
    }
}
