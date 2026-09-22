import { NextRequest } from "next/server";
import { z } from "zod";

import {
  backendJsonResponse,
  getAuthHeaders,
  getAuthToken,
  messageTriggerUpstreamErrorResponse,
  parseBody,
  unauthorizedResponse,
} from "@babyjamjam/shared/api";
import { serverAPIClient } from "@/lib/api/server";

const triggerDispatchActivationSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const ENDPOINT = "/settings/message-policy-activations/trigger-dispatch";

export async function PUT(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Authentication required. Please log in.");
    }

    const { data, response: invalidBody } = await parseBody(
      triggerDispatchActivationSchema,
      request,
    );
    if (invalidBody) {
      return invalidBody;
    }

    const response = await serverAPIClient.put(ENDPOINT, data, {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return messageTriggerUpstreamErrorResponse(error, "update message trigger dispatch activation");
  }
}
