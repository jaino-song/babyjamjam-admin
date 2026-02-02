import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const categoryId = searchParams.get("categoryId");
        
        const params: Record<string, string> = {};
        if (categoryId) params.categoryId = categoryId;

        const response = await serverAPIClient.get("/documents", {
            params,
            headers: { Authorization: `Bearer ${token}` },
        });
        return NextResponse.json(response.data);
    } catch (error) {
        console.error("[file-storage/documents] GET error:", error);
        return NextResponse.json(
            { error: "Failed to fetch documents" },
            { status: 500 }
        );
    }
}

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
                Authorization: `Bearer ${token}`,
            },
        });

        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        console.error("[file-storage/documents] POST error:", error);
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
