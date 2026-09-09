import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  getAuthHeaders,
  getAuthToken,
  invalidJsonResponse,
  logUpstreamError,
  readJsonObjectBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Authentication required. Please log in.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectBody(request);
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) return invalidJson;
    logUpstreamError("prepare receipt link", error);
    return NextResponse.json({ error: "Failed to prepare receipt link" }, { status: 500 });
  }

  const clientId = body.clientId;
  if (!Number.isInteger(clientId) || Number(clientId) <= 0) {
    return NextResponse.json(
      { reason: "invalid_request", message: "산모 선택 정보가 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    const response = await serverAPIClient.post(
      "/receipt-links/prepare",
      { clientId },
      { headers: getAuthHeaders(token) },
    );
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      if (status && status >= 400 && status < 500) {
        return NextResponse.json(error.response?.data ?? { reason: "unknown" }, { status });
      }
    }
    logUpstreamError("prepare receipt link", error);
    return NextResponse.json({ error: "Failed to prepare receipt link" }, { status: 500 });
  }
}
