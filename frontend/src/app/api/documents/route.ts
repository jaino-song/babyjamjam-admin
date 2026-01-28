import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

/**
 * Helper to extract auth token from cookies
 */
function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

/**
 * GET /api/documents
 * List all documents with optional category filter
 * Note: This endpoint doesn't require eformsign auth - it's for internal documents
 */
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const category = searchParams.get("category");
        
        const params: Record<string, string> = {};
        if (category) params.category = category;
        
        const response = await serverAPIClient.get("/documents", { params });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error("[documents] GET error:", error);
        return NextResponse.json(
            { error: "Failed to fetch documents" },
            { status: 500 }
        );
    }
}

/**
 * POST /api/documents
 * Upload a new document with file
 */
export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json(
                { error: "File is required" },
                { status: 400 }
            );
        }

        // Reconstruct FormData for backend (required for server-to-server)
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const backendFormData = new FormData();
        const blob = new Blob([buffer], { type: file.type });
        backendFormData.append("file", blob, file.name);

        // Append metadata fields
        const name = formData.get("name");
        const description = formData.get("description");
        const category = formData.get("category");
        const tags = formData.get("tags");
        const orgId = formData.get("orgId");
        const uploadedBy = formData.get("uploadedBy");

        if (name) backendFormData.append("name", name as string);
        if (description) backendFormData.append("description", description as string);
        if (category) backendFormData.append("category", category as string);
        if (tags) backendFormData.append("tags", tags as string);
        if (orgId) backendFormData.append("orgId", orgId as string);
        if (uploadedBy) backendFormData.append("uploadedBy", uploadedBy as string);

        const response = await serverAPIClient.post("/documents/upload", backendFormData, {
            timeout: 120000,
        });

        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        console.error("[documents] POST error:", error);
        // Handle axios error with more detail
        if (error && typeof error === "object" && "response" in error) {
            const axiosError = error as { response?: { status: number; data: unknown } };
            if (axiosError.response) {
                return NextResponse.json(
                    axiosError.response.data || { error: "Upload failed" },
                    { status: axiosError.response.status }
                );
            }
        }
        return NextResponse.json(
            { error: "Failed to upload document" },
            { status: 500 }
        );
    }
}
