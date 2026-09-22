import { NextRequest } from "next/server";

import { BACKEND_BASE_URL } from "@/lib/api/server";
import { getAuthToken } from "@/lib/api/route-utils";
import {
  unauthorizedProblemResponse,
  upstreamSseTransportErrorResponse,
  upstreamSseUpstreamErrorResponse,
} from "@/lib/api/problem-responses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedProblemResponse();
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND_BASE_URL}/eformsign-docs/events`, {
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
