import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  getAuthHeaders,
  getAuthToken,
  messageTriggerUpstreamErrorResponse,
  parseBody,
  unauthorizedResponse,
} from "@babyjamjam/shared/api";

const activationWithParentSchema = z
  .object({
    isActive: z.literal(true),
    enableParent: z.literal(true),
  })
  .strict();

type RouteContext = {
  params: Promise<{ triggerId: string }>;
};

function isValidTriggerId(triggerId: string): boolean {
  return /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/.test(triggerId);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { triggerId } = await context.params;
    if (!isValidTriggerId(triggerId)) {
      return NextResponse.json({ error: "Invalid trigger id" }, { status: 400 });
    }

    const { data, response: invalidBody } = await parseBody(
      activationWithParentSchema,
      request,
    );
    if (invalidBody) {
      return invalidBody;
    }

    const response = await serverAPIClient.put(
      `/message-trigger-rules/${encodeURIComponent(triggerId)}/activation-with-parent`,
      data,
      { headers: getAuthHeaders(token) },
    );
    return backendJsonResponse(response);
  } catch (error) {
    return messageTriggerUpstreamErrorResponse(error, "activate message trigger rule with parent");
  }
}
