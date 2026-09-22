import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { z } from "zod";

import {
    authRequiredResponse,
    logUpstreamError,
    parseBody,
    parseUpstreamJsonObject,
    upstreamStatusProblemResponse,
} from "@/lib/api/route-utils";

const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview";
const BACKEND_URL = isProduction
    ? process.env.NEXT_PUBLIC_API_BASE_URL
    : process.env.DEVELOPMENT_API_BASE_URL;

const chatConfirmSchema = z
    .object({
        intentId: z.string().min(1),
        nonce: z.string().min(1),
        sessionId: z.string().min(1).nullable().optional(),
    })
    .strict();

export async function POST(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return authRequiredResponse();
    }

    const { data, response } = await parseBody(chatConfirmSchema, request);
    if (response) return response;

    try {
        const backendResponse = await fetch(`${BACKEND_URL}/ai/chat/confirm`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken.value}`,
            },
            body: JSON.stringify(data),
        });

        if (!backendResponse.ok) {
            const upstreamBody = await backendResponse.text().catch(() => "");
            logUpstreamError(
                "confirm chat intent",
                { response: { status: backendResponse.status } },
                upstreamBody,
            );
            // EM-STATE-01: an upstream 5xx leaves the application result
            // unconfirmable (UNKNOWN), so the outcome default must not stamp
            // NOT_APPLIED. A faithful upstream problem body is propagated;
            // anything else is sanitized to the registered catalog copy.
            return upstreamStatusProblemResponse(
                backendResponse.status,
                "confirm chat intent",
                undefined,
                "mutation",
                parseUpstreamJsonObject(upstreamBody),
            );
        }

        const responseBody = await backendResponse.text();
        return new Response(responseBody || "{}", {
            status: backendResponse.status,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        // Transport failure: the intent may or may not have been applied.
        logUpstreamError("confirm chat intent", error);
        return upstreamStatusProblemResponse(502, "confirm chat intent", undefined, "mutation");
    }
}
