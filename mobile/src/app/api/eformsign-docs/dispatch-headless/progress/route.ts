import { NextRequest } from "next/server";
import { getAuthToken } from "@/lib/api/route-utils";
import {
    unauthorizedProblemResponse,
    upstreamSseTransportErrorResponse,
    upstreamSseUpstreamErrorResponse,
    validationProblemResponse,
} from "@/lib/api/problem-responses";
import { BACKEND_BASE_URL } from "@/lib/api/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedProblemResponse();
    }

    const progressId = request.nextUrl.searchParams.get("progressId");
    if (!progressId) {
        return validationProblemResponse("progressId is required", [
            { pointer: "/progressId", code: "REQUIRED", detail: "필수 항목이에요.", location: "query" },
        ]);
    }

    const upstreamUrl = `${BACKEND_BASE_URL}/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`;

    let upstream: Response;
    try {
        upstream = await fetch(upstreamUrl, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "text/event-stream",
            },
            signal: request.signal,
            cache: "no-store",
        });
    } catch {
        return upstreamSseTransportErrorResponse("read");
    }

    if (!upstream.ok || !upstream.body) {
        const upstreamText = await upstream.text().catch(() => "");
        return upstreamSseUpstreamErrorResponse(upstream.status, upstreamText || undefined, "read");
    }

    return new Response(upstream.body, {
        status: 200,
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
