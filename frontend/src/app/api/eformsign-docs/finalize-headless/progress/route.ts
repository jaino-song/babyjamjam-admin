import { NextRequest } from "next/server";
import {
  authRequiredResponse,
  getAuthToken,
  localValidationProblemResponse,
  upstreamSseProblemErrorResponse,
} from "@/lib/api/route-utils";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    const progressId = request.nextUrl.searchParams.get("progressId");
    if (!progressId) {
        return localValidationProblemResponse([
            {
                pointer: "/progressId",
                code: "REQUIRED",
                detail: "진행 상황 식별자가 필요해요.",
                location: "query",
            },
        ]);
    }

    const upstreamUrl = createServerApiUrl(
        `/eformsign-docs/finalize-headless/progress?progressId=${encodeURIComponent(progressId)}`,
    );

    const upstream = await fetch(upstreamUrl, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
        },
        signal: request.signal,
        cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
        // SSE transports cannot carry problem+json; the error event carries
        // the registered catalog code instead, and the upstream body stays
        // server-side.
        return upstreamSseProblemErrorResponse(upstream.status);
    }

    return new Response(upstream.body, {
        status: 200,
        headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
