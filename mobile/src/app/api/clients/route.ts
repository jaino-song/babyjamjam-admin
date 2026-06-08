import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
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
        return errorResponse(error, "create client");
    }
}
