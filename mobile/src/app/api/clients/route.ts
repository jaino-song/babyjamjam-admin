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
    unauthorizedResponse,
    withNoStore,
} from "@/lib/api/route-utils";

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
    })
    .passthrough();

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
            return unauthorizedResponse("Unauthorized");
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
        return errorResponse(error, "fetch clients");
    }
}

// POST /api/clients - Create a new client
export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("Unauthorized");
    }

    const { data, response } = await parseBody(createClientSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.post("/clients", data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(backendResponse);
    } catch (error) {
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
        return errorResponse(error, "create client");
    }
}
