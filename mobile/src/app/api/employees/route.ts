import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend CreateEmployeeDto: name (@IsString), workArea (@IsArray
// @IsString each), phone (@IsString), grade (@IsString — backend normalizes
// then @IsIn EMPLOYEE_GRADES, so we accept any string here), openToNextWork
// (@IsBoolean) are required; registeredDate is @IsOptional. Passthrough keeps
// forward-compatible fields for the backend's authoritative ValidationPipe.
const createEmployeeSchema = z
    .object({
        name: z.string(),
        workArea: z.array(z.string()),
        phone: z.string(),
        grade: z.string(),
        openToNextWork: z.boolean(),
    })
    .passthrough();

// Mirrors backend UpdateEmployeeDto: every field is @IsOptional, so a
// passthrough object that type-checks known fields is sufficient.
const updateEmployeeSchema = z
    .object({
        name: z.string().optional(),
        workArea: z.array(z.string()).optional(),
        phone: z.string().optional(),
        grade: z.string().optional(),
        openToNextWork: z.boolean().optional(),
    })
    .passthrough();

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
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { data, response: invalid } = await parseBody(createEmployeeSchema, request);
    if (invalid) {
        return invalid;
    }

    try {
        const response = await serverAPIClient.post("/employees", data, {
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "create employee");
    }
}

// PATCH /api/employees?id=X - Update an employee
export async function PATCH(request: NextRequest) {
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

    const { data, response: invalid } = await parseBody(updateEmployeeSchema, request);
    if (invalid) {
        return invalid;
    }

    try {
        const response = await serverAPIClient.patch("/employees", data, {
            params: { id },
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
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
