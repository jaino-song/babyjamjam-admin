import { NextRequest, NextResponse } from "next/server";
import { getClientConflictPayload } from "@babyjamjam/shared";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    getSafeApiDisplayMessage,
    sanitizeApiDisplayMessage,
} from "@/lib/errors/safe-api-error-message";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    withNoStore,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

// Mirrors backend CreateClientDto: `name` (@IsString) plus the three booleans
// `careCenter`, `voucherClient`, `breastPump` (@IsBoolean, no @IsOptional) are
// required. Every other field is @IsOptional, so it passes through to the
// backend's authoritative ValidationPipe.
const createClientSchema = z
    .object({
        name: z.string().max(10_000),
        careCenter: z.boolean(),
        voucherClient: z.boolean(),
        breastPump: z.boolean(),
        confirmedUnavailableEmployeeIds: z.array(z.number().int()).nonempty().optional(),
    })
    .passthrough();

type EmployeeActivationConfirmation = {
    code: "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED";
    unavailableEmployees: Array<{ id: number; name: string }>;
};

function getEmployeeActivationConfirmation(error: unknown): EmployeeActivationConfirmation | null {
    const response = (error as { response?: { status?: unknown; data?: unknown } } | null)
        ?.response;
    if (response?.status !== 409) return null;
    const payload = response.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const candidate = payload as { code?: unknown; unavailableEmployees?: unknown };
    if (
        candidate.code !== "EMPLOYEE_ACTIVATION_CONFIRMATION_REQUIRED"
        || !Array.isArray(candidate.unavailableEmployees)
    ) return null;

    const unavailableEmployees = candidate.unavailableEmployees.flatMap((employee) => {
        if (!employee || typeof employee !== "object" || Array.isArray(employee)) return [];
        const { id, name } = employee as { id?: unknown; name?: unknown };
        return Number.isInteger(id) && typeof name === "string"
            ? [{ id: id as number, name }]
            : [];
    });
    return unavailableEmployees.length === candidate.unavailableEmployees.length
        ? { code: candidate.code, unavailableEmployees }
        : null;
}

function hasPrismaErrorCode(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const payload = (error as { response?: { data?: unknown } }).response?.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return false;
    }

    const code = (payload as { code?: unknown }).code;
    return typeof code === "string" && /^P\d{4}$/.test(code);
}

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

// GET /api/clients - Get all clients (with optional pagination)
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedProblemResponse();
        }

        const searchParams = request.nextUrl.searchParams;
        const page = searchParams.get("page");
        const limit = searchParams.get("limit");
        const search = searchParams.get("search");
        const filter = searchParams.get("filter");

        const params: Record<string, string> = {};
        if (page) params.page = page;
        if (limit) params.limit = limit;
        if (search) params.search = search;
        if (filter) params.filter = filter;

        const response = await serverAPIClient.get("/clients", { 
            params,
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch clients", "read");
    }
}

// POST /api/clients - Create a new client
export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedProblemResponse();
    }

    const { data, response } = await parseBody(createClientSchema, request);
    if (response) return response;

    try {
        const backendPath = data.confirmedUnavailableEmployeeIds
            ? "/clients/with-employee-activation"
            : "/clients";
        const backendResponse = await serverAPIClient.post(backendPath, data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
        const employeeConfirmation = getEmployeeActivationConfirmation(error);
        if (employeeConfirmation) {
            return NextResponse.json(employeeConfirmation, {
                status: 409,
                headers: { "Cache-Control": "no-store" },
            });
        }
        if (!hasUpstreamProblemCode(error)) {
            const conflict = hasPrismaErrorCode(error)
                ? null
                : getClientConflictPayload(error);
            if (conflict) {
                const safeMessage = getSafeApiDisplayMessage(error);
                if (safeMessage) {
                    return NextResponse.json(
                        {
                            message: sanitizeApiDisplayMessage(safeMessage),
                            ...(conflict.clientId === undefined ? {} : { clientId: conflict.clientId }),
                        },
                        { status: 409 },
                    );
                }
            }
        }
        return errorResponse(error, "create client", "mutation");
    }
}
