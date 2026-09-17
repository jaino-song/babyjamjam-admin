import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
} from "@/lib/api/route-utils";
import { createMessageTriggerRuleSchema } from "@babyjamjam/shared/types/message";

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const response = await serverAPIClient.get("/message-trigger-rules", {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "fetch message trigger rules", "read");
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const { data, response: invalidBody } = await parseBody(
      createMessageTriggerRuleSchema,
      request,
    );
    if (invalidBody) {
      return invalidBody;
    }

    const response = await serverAPIClient.post("/message-trigger-rules", data, {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "create message trigger rule", "mutation");
  }
}
