import { NextRequest } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";

// The approval request no longer carries a sender number — all messages send
// from the unified, pre-registered number. Accept an empty body and preserve
// forward-compatible fields for the backend contract.
const requestMessageSenderApprovalSchema = z.object({}).passthrough();

/**
 * Shared handler for the canonical `/request` endpoint and the legacy base
 * POST alias. Keeping the handler here ensures both routes have identical
 * auth, validation, upstream status, and error behavior.
 */
export async function handleMessageSenderApprovalRequest(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  const { data, response: invalid } = await parseBody(
    requestMessageSenderApprovalSchema,
    request,
  );
  if (invalid) {
    return invalid;
  }

  try {
    const response = await serverAPIClient.post(
      "/settings/message-sender-approval/request",
      data,
      {
        headers: getAuthHeaders(token),
      },
    );

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "message sender approval request");
  }
}

export const POST = handleMessageSenderApprovalRequest;
