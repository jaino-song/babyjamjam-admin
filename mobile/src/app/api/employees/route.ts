import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getConflictPayload } from "@babyjamjam/shared";

import { serverAPIClient } from "@/lib/api/server";
import { invalidEmployeeIdResponse, isValidEmployeeId } from "./employee-route-utils";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// A converted problem body must keep its public `code`; the legacy conflict
// bridge only carries message/clientId, so registered problems fall through
// to the contract-preserving errorResponse passthrough instead.
function hasUpstreamProblemCode(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const payload = (error as { response?: { data?: unknown } }).response?.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return false;
    }

    return typeof (payload as { code?: unknown }).code === "string";
}

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
        if (!hasUpstreamProblemCode(error)) {
            const conflict = getConflictPayload(error);
            if (conflict) {
                return NextResponse.json(conflict, { status: 409 });
            }
        }
        return errorResponse(error, "delete employee");
    }
}
