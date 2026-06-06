import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  getAuthHeaders,
  getAuthToken,
  getUpstreamErrorStatus,
  invalidJsonResponse,
  logUpstreamError,
  readJsonObjectBody,
  sanitizeUpstreamClientError,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readJsonObjectBody(request);
    const response = await serverAPIClient.post("/message-deliveries/sms", body, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) {
      return invalidJson;
    }

    if (error && typeof error === "object" && "response" in error) {
      const axiosErr = error as { response?: { status?: number; data?: unknown } };
      if (axiosErr.response) {
        const status = getUpstreamErrorStatus(error);
        logUpstreamError("API send SMS", error);
        return NextResponse.json(
          sanitizeUpstreamClientError(axiosErr.response.data, "Failed to send SMS"),
          { status },
        );
      }
    }
    logUpstreamError("API send SMS", error);
    return NextResponse.json(
      { error: "Failed to send SMS" },
      { status: 500 },
    );
  }
}
