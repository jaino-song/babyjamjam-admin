import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  unauthorizedResponse,
  withNoStore,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ clientId: string }> };

function isValidClientId(value: string): boolean {
  const parsed = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed > 0;
}

/** One client's message history page; the backend scopes it to the caller's branch. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { clientId } = await params;
    if (!isValidClientId(clientId)) {
      return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
    }

    const searchParams = request.nextUrl.searchParams;
    const response = await serverAPIClient.get(`/message-logs/client/${encodeURIComponent(clientId)}`, {
      headers: getAuthHeaders(token),
      params: {
        limit: searchParams.get("limit") ?? undefined,
        cursor: searchParams.get("cursor") ?? undefined,
      },
    });
    return withNoStore(backendJsonResponse(response));
  } catch (error) {
    return errorResponse(error, "fetch client message history");
  }
}
