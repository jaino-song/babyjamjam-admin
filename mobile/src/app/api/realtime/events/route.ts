import { NextRequest } from "next/server";

import { BACKEND_BASE_URL } from "@/lib/api/server";
import { getAuthToken } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";
import { proxySseStream } from "@/lib/realtime/sse-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The stream closes itself at 50s; this remains the final platform safety net.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedProblemResponse();
  }

  return proxySseStream({
    upstreamUrl: `${BACKEND_BASE_URL}/realtime/events`,
    lastEventId: request.headers.get("Last-Event-ID"),
    requestSignal: request.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "text/event-stream",
    },
  });
}
