import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  invalidJsonResponse,
  readJsonObjectBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  try {
    const response = await serverAPIClient.get("/settings/message-sender-approval", {
      headers: getAuthHeaders(token),
    });

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "message sender approval fetch");
  }
}

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  try {
    const body = await readJsonObjectBody(request);
    const response = await serverAPIClient.post(
      "/settings/message-sender-approval/request",
      body,
      {
        headers: getAuthHeaders(token),
      },
    );

    return backendJsonResponse(response);
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) {
      return invalidJson;
    }

    return errorResponse(error, "message sender approval request");
  }
}
