import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import { parseBody } from "@/lib/api/route-utils";

const BACKEND_URL = BACKEND_BASE_URL;

// Mirrors backend ChatFeedbackDto: `sessionId` (@IsNotEmpty @IsString) and
// `type` (@IsIn positive|negative) are required. `messageId`, `messageIndex`
// (@IsInt @Min(0)) and `comment` are optional. Other fields pass through.
const chatFeedbackSchema = z
    .object({
        sessionId: z.string().min(1),
        type: z.enum(["positive", "negative"]),
        messageId: z.string().optional(),
        messageIndex: z.number().int().min(0).optional(),
        comment: z.string().optional(),
    })
    .passthrough();

export async function POST(req: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");
    if (!authToken) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const { data, response: invalidBody } = await parseBody(chatFeedbackSchema, req);
    if (invalidBody) return invalidBody;

    try {
        const response = await fetch(`${BACKEND_URL}/ai/chat/feedback`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(data),
        });

        const responseData = await response.json();
        return NextResponse.json(responseData, { status: response.status });
    } catch (error) {
        console.error("Feedback proxy error:", error);
        return NextResponse.json({ success: false, error: "Failed to submit feedback" }, { status: 500 });
    }
}
