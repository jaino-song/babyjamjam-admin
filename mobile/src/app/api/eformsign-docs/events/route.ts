import { NextRequest } from "next/server";

import { BACKEND_BASE_URL } from "@/lib/api/server";
import { getAuthToken, upstreamStreamErrorResponse } from "@/lib/api/route-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstream = await fetch(`${BACKEND_BASE_URL}/eformsign-docs/events`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
    signal: request.signal,
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return upstreamStreamErrorResponse(upstream, "Unable to open eformsign document event stream");
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
