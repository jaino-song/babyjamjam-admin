import { NextRequest, NextResponse } from "next/server";
import { getClientConflictPayload } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import {
    authRequiredResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
} from "@/lib/api/route-utils";

// A converted problem body must keep its public `code`; the legacy conflict
// bridge only carries message/clientId, so registered problems fall through
// to the contract-preserving errorResponse passthrough instead.
function hasUpstreamProblemCode(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const payload = (error as { response?: { data?: unknown } }).response?.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    return typeof (payload as { code?: unknown }).code === "string";
}

// GET /api/clients - Get all clients (with optional pagination)
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
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
        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch clients", "read");
    }
}

// POST /api/clients - Create a new client
export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return authRequiredResponse();
        }

        const body = await request.json();
        const response = await serverAPIClient.post("/clients", body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        if (!hasUpstreamProblemCode(error)) {
            const conflict = getClientConflictPayload(error);
            if (conflict) {
                return NextResponse.json(conflict, { status: 409 });
            }
        }
        return errorResponse(error, "create client", "mutation");
    }
}
