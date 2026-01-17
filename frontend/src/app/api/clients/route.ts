import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

// Helper to get auth token from request
function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

// Helper to create authorization headers
function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// GET /api/clients - Get all clients (with optional pagination)
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
        console.error("[API] Error fetching clients:", error);
        return NextResponse.json(
            { error: "Failed to fetch clients" },
            { status: 500 }
        );
    }
}

// POST /api/clients - Create a new client
export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const response = await serverAPIClient.post("/clients", body, {
            headers: getAuthHeaders(token),
        });
        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        console.error("[API] Error creating client:", error);
        return NextResponse.json(
            { error: "Failed to create client" },
            { status: 500 }
        );
    }
}

