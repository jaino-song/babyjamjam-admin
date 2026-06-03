import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { searchParams } = new URL(request.url);
        const categoryId = searchParams.get("categoryId");
        
        const params: Record<string, string> = {};
        if (categoryId) params.categoryId = categoryId;

        const response = await serverAPIClient.get("/documents", {
            params,
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch documents");
    }
}

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const formData = await request.formData();
        const file = formData.get("file") as File | null;

        if (!file) {
            return NextResponse.json(
                { error: "File is required" },
                { status: 400 }
            );
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const backendFormData = new FormData();
        const blob = new Blob([buffer], { type: file.type });
        backendFormData.append("file", blob, file.name);

        const name = formData.get("name");
        const description = formData.get("description");
        const categoryId = formData.get("categoryId");
        const tags = formData.get("tags");
        const orgId = formData.get("orgId");
        const uploadedBy = formData.get("uploadedBy");

        if (name) backendFormData.append("name", name as string);
        if (description) backendFormData.append("description", description as string);
        if (categoryId) backendFormData.append("categoryId", categoryId as string);
        if (tags) backendFormData.append("tags", tags as string);
        if (orgId) backendFormData.append("orgId", orgId as string);
        if (uploadedBy) backendFormData.append("uploadedBy", uploadedBy as string);

        const response = await serverAPIClient.post("/documents/upload", backendFormData, {
            timeout: 120000,
            headers: {
                "Content-Type": undefined,
                ...getAuthHeaders(token),
            },
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "upload document");
    }
}
