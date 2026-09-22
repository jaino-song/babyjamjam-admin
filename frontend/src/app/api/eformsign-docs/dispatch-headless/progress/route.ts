import { NextRequest } from "next/server";

import { proxySseStream } from "@/lib/api/sse-proxy";
import {
  authRequiredResponse,
  getAuthToken,
  localValidationProblemResponse,
} from "@/lib/api/route-utils";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
        `/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
    );

    return proxySseStream({
        upstreamUrl,
        lastEventId: request.headers.get("Last-Event-ID"),
        requestSignal: request.signal,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
        },
    });
}
