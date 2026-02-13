import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
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
        console.error("[API] Error fetching employees:", error);
        return NextResponse.json(
            { error: "Failed to fetch employees" },
            { status: 500 }
        );
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
    } catch (error: any) {
        console.error("[API] Error creating employee:", error.response?.data || error.message);
        // Pass through actual backend error response or create error object
        if (error.response?.data) {
            return NextResponse.json(error.response.data, { status: error.response.status || 500 });
        }
        return NextResponse.json(
            { message: error.message || "Failed to create employee", error: "Internal Server Error" },
            { status: 500 }
        );
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
    } catch (error: any) {
        console.error("[API] Error updating employee:", error.response?.data || error.message);
        if (error.response?.data) {
            return NextResponse.json(error.response.data, { status: error.response.status || 500 });
        }
        return NextResponse.json(
            { message: error.message || "Failed to update employee", error: "Internal Server Error" },
            { status: 500 }
        );
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
        console.error("[API] Error deleting employee:", error);
        return NextResponse.json(
            { error: "Failed to delete employee" },
            { status: 500 }
        );
    }
}
