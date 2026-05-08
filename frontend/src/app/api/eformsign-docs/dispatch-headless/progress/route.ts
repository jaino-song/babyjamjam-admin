import { NextRequest } from "next/server";
import { getAuthToken } from "@/lib/api/route-utils";
import { createServerApiUrl } from "@/lib/api/server-base-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    if (!token) {
        return new Response("Unauthorized", { status: 401 });
    }

    const progressId = request.nextUrl.searchParams.get("progressId");
    if (!progressId) {
        return new Response("progressId is required", { status: 400 });
    }

    const upstreamUrl = createServerApiUrl(
        `/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
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
