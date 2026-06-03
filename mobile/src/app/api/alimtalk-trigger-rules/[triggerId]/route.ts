import { NextRequest, NextResponse } from "next/server";
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
  return `/alimtalk-trigger-rules/${encodeURIComponent(triggerId)}`;
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
    return errorResponse(error, "fetch alimtalk trigger rule");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { triggerId } = await context.params;
    if (!isValidTriggerId(triggerId)) {
      return invalidTriggerIdResponse();
    }

    const body = await readJsonObjectBody(request);
    const response = await serverAPIClient.patch(triggerRulePath(triggerId), body, {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) {
      return invalidJson;
    }

    return errorResponse(error, "update alimtalk trigger rule");
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
    return errorResponse(error, "delete alimtalk trigger rule");
  }
}
