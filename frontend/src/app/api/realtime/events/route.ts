import { NextRequest } from "next/server";

import { proxySseStream } from "@/lib/api/sse-proxy";
import { authRequiredResponse, getAuthToken } from "@/lib/api/route-utils";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The stream closes itself at 50s; this remains the final platform safety net.
export const maxDuration = 60;

// Contract: an opaque resume cursor, at most 64 chars of [0-9A-Za-z:._-]. The
// proxy only validates it so junk never reaches the backend; it never parses it.
const CURSOR_PATTERN = /^[0-9A-Za-z:._-]{1,64}$/;

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return authRequiredResponse();
    }

    const since = request.nextUrl.searchParams.get("since");
    const baseUrl = createServerApiUrl("/realtime/events");
    const upstreamUrl =
        since !== null && CURSOR_PATTERN.test(since)
            ? `${baseUrl}?since=${encodeURIComponent(since)}`
            : baseUrl;

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
