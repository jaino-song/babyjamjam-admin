import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
} from "@/lib/api/route-utils";
import { updateMessageTriggerRuleSchema } from "@babyjamjam/shared/types/message";

type RouteContext = {
  params: Promise<{ triggerId: string }>;
};

function isValidTriggerId(triggerId: string): boolean {
  return /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*$/.test(triggerId);
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
      return authRequiredResponse();
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
    return errorResponse(error, "fetch message trigger rule", "read");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const { triggerId } = await context.params;
    if (!isValidTriggerId(triggerId)) {
      return invalidTriggerIdResponse();
    }

    const { data, response: invalidBody } = await parseBody(
      updateMessageTriggerRuleSchema,
      request,
    );
    if (invalidBody) {
      return invalidBody;
    }

    const response = await serverAPIClient.patch(triggerRulePath(triggerId), data, {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "update message trigger rule", "mutation");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
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
    return errorResponse(error, "delete message trigger rule", "mutation");
  }
}
