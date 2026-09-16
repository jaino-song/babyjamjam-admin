import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  getAuthHeaders,
  getAuthToken,
  messageTriggerUpstreamErrorResponse,
  unauthorizedResponse,
  withNoStore,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

function isValidMessageLogId(value: string): boolean {
  const parsed = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed > 0;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { id } = await params;
    if (!isValidMessageLogId(id)) {
      return NextResponse.json({ error: "Invalid message log id" }, { status: 400 });
    }

    const response = await serverAPIClient.post(
      `/message-logs/${encodeURIComponent(id)}/retry`,
      {},
      { headers: getAuthHeaders(token) },
    );
    return withNoStore(backendJsonResponse(response));
  } catch (error) {
    return messageTriggerUpstreamErrorResponse(error, "retry message log");
  }
}
