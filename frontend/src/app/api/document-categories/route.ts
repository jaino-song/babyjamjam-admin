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

        const response = await serverAPIClient.get("/document-categories");
        return NextResponse.json(response.data);
    } catch (error) {
        console.error("[document-categories] GET error:", error);
        return NextResponse.json(
            { error: "Failed to fetch document categories" },
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

        const body = await request.json();
        console.log("[document-categories] POST body:", JSON.stringify(body));
        const response = await serverAPIClient.post("/document-categories", body);
        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        console.error("[document-categories] POST error:", error);
        return NextResponse.json(
            { error: "Failed to create document category" },
            { status: 500 }
        );
    }
}
