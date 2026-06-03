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
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const response = await serverAPIClient.get("/alimtalk-trigger-rules", {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "fetch alimtalk trigger rules");
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const body = await readJsonObjectBody(request);
    const response = await serverAPIClient.post("/alimtalk-trigger-rules", body, {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) {
      return invalidJson;
    }

    return errorResponse(error, "create alimtalk trigger rule");
  }
}
