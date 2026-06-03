import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { invalidJsonResponse, readJsonObjectBody } from "@/lib/api/route-utils";

const BACKEND_URL = BACKEND_BASE_URL;

export async function POST(req: NextRequest) {
    try {
        const cookieStore = await cookies();
        const authToken = cookieStore.get("auth_token");
        if (!authToken) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await readJsonObjectBody(req);

        const response = await fetch(`${BACKEND_URL}/ai/chat/feedback`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        console.error("Feedback proxy error:", error);
        return NextResponse.json({ success: false, error: "Failed to submit feedback" }, { status: 500 });
    }
}
