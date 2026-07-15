import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { AxiosError } from "axios";
import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";

type BackendErrorPayload = {
    message?: string;
    error?: string;
} & Record<string, unknown>;

function employeeMutationErrorResponse(error: unknown, fallbackMessage: string) {
    const axiosError = error as AxiosError<BackendErrorPayload>;
    console.error("[API] Employee mutation error:", axiosError.response?.data || axiosError.message);

    if (axiosError.response?.data) {
        return NextResponse.json(axiosError.response.data, { status: axiosError.response.status || 500 });
    }

    return NextResponse.json(
        { message: axiosError.message || fallbackMessage, error: "Internal Server Error" },
        { status: 500 }
    );
}

// GET /api/employees - Get all employees
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        return employeeMutationErrorResponse(error, "Failed to create employee");
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

        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        return employeeMutationErrorResponse(error, "Failed to update employee");
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

        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        return errorResponse(error, "delete employee");
    }
}
