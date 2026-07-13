import { NextRequest, NextResponse } from "next/server";
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

// Mirrors backend UpdateMessageTriggerRuleDto: every field is @IsOptional,
// so a passthrough object that type-checks known fields is sufficient. The
// backend's authoritative ValidationPipe owns the enum/@Min constraints.
const updateTriggerRuleSchema = z
  .object({
    name: z.string().optional(),
    isActive: z.boolean().optional(),
    eventType: z.string().optional(),
    offsetType: z.string().optional(),
    offsetDays: z.number().optional(),
    recipientType: z.string().optional(),
    templateKey: z.string().optional(),
  })
  .passthrough();

type RouteContext = {
  params: Promise<{ triggerId: string }>;
};

function isValidTriggerId(triggerId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(triggerId);
}

function invalidTriggerIdResponse(): NextResponse {
  return NextResponse.json({ error: "Invalid trigger id" }, { status: 400 });
}

function triggerRulePath(triggerId: string): string {
  return `/message-trigger-rules/${encodeURIComponent(triggerId)}`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { triggerId } = await context.params;
    if (!isValidTriggerId(triggerId)) {
      return invalidTriggerIdResponse();
    }

    const response = await serverAPIClient.get(triggerRulePath(triggerId), {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "fetch message trigger rule");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  const { triggerId } = await context.params;
  if (!isValidTriggerId(triggerId)) {
    return invalidTriggerIdResponse();
  }

  const { data, response: invalid } = await parseBody(updateTriggerRuleSchema, request);
  if (invalid) {
    return invalid;
  }

  try {
    const response = await serverAPIClient.patch(triggerRulePath(triggerId), data, {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "update message trigger rule");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { triggerId } = await context.params;
    if (!isValidTriggerId(triggerId)) {
      return invalidTriggerIdResponse();
    }

    const response = await serverAPIClient.delete(triggerRulePath(triggerId), {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "delete message trigger rule");
  }
}
