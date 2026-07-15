import { NextRequest } from "next/server";
import { getAuthToken } from "@/lib/api/route-utils";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Keep the proxied SSE stream alive longer before Vercel recycles the
// function. The client (useEformsignDocsLiveStream) reconnects regardless,
// so this only reduces reconnect churn; 60s is within every Vercel plan's cap.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return new Response("Unauthorized", { status: 401 });
    }

    const upstreamUrl = createServerApiUrl("/eformsign-docs/events");

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
        return new Response(null, { status: upstream.status });
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
