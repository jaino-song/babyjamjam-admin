import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

// GET /api/employees - Get all employees
export async function GET(request: NextRequest) {
    try {
        const response = await serverAPIClient.get("/employees");

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
        const body = await request.json();
        const response = await serverAPIClient.post("/employees", body);

        // Check if backend returned an error status
        if (response.status >= 400) {
            console.error("[API] Backend error creating employee:", response.data);
            const errorMessage = response.data?.message || "Failed to create employee";
            return NextResponse.json(
                { error: errorMessage },
                { status: response.status }
            );
        }

        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        console.error("[API] Error creating employee:", error);
        return NextResponse.json(
            { error: "Failed to create employee" },
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

        const body = await request.json();
        const response = await serverAPIClient.patch("/employees", body, {
            params: { id }
        });

        // Check if backend returned an error status
        if (response.status >= 400) {
            console.error("[API] Backend error updating employee:", response.data);
            return NextResponse.json(
                { error: response.data?.message || "Failed to update employee" },
                { status: response.status }
            );
        }

        return NextResponse.json(response.data);
    } catch (error) {
        console.error("[API] Error updating employee:", error);
        return NextResponse.json(
            { error: "Failed to update employee" },
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

        const response = await serverAPIClient.delete("/employees", {
            params: { id }
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
