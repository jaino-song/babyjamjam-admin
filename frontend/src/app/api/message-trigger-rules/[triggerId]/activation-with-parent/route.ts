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
const PARENT_DISABLED_CODE = "MESSAGE_AUTOMATION_PARENT_DISABLED";

type RouteContext = {
  params: Promise<{ triggerId: string }>;
};

function isValidTriggerId(triggerId: string): boolean {
  return /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/.test(triggerId);
}

function isParentDisabledConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("response" in error)) return false;
  const response = (error as { response?: { status?: unknown; data?: unknown } }).response;
  if (response?.status !== 409 || !response.data || typeof response.data !== "object") return false;
  const payload = response.data as { code?: unknown; error?: unknown };
  if (payload.code === PARENT_DISABLED_CODE) return true;
  return Boolean(
    payload.error &&
    typeof payload.error === "object" &&
    (payload.error as { code?: unknown }).code === PARENT_DISABLED_CODE,
  );
}

function parentDisabledConflictResponse(error: unknown): NextResponse {
  const status = (error as { response?: { status?: unknown } }).response?.status;
  return NextResponse.json(
    {
      error: "Failed to activate message trigger rule with parent",
      code: PARENT_DISABLED_CODE,
    },
    { status: typeof status === "number" ? status : 409 },
  );
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
    if (isParentDisabledConflict(error)) {
      return parentDisabledConflictResponse(error);
    }
    return messageTriggerUpstreamErrorResponse(error, "activate message trigger rule with parent");
  }
}
