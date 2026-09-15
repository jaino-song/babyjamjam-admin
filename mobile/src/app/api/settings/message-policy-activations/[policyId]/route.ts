import { STORED_MESSAGE_SETTINGS_POLICY_IDS } from "@babyjamjam/shared/types/message";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  backendJsonResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  parseBody,
  unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

const policyIdSchema = z.enum(STORED_MESSAGE_SETTINGS_POLICY_IDS);
const activationSchema = z.object({ enabled: z.boolean() });

type RouteContext = {
  params: Promise<{ policyId: string }>;
};

export async function PUT(request: NextRequest, context: RouteContext) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  const { policyId: rawPolicyId } = await context.params;
  const parsedPolicyId = policyIdSchema.safeParse(rawPolicyId);
  if (!parsedPolicyId.success) {
    return NextResponse.json({ error: "Invalid policy id" }, { status: 400 });
  }

  const { data, response: invalid } = await parseBody(activationSchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(await serverAPIClient.put(
      `/settings/message-policy-activations/${parsedPolicyId.data}`,
      data,
      { headers: getAuthHeaders(token) },
    ));
  } catch (error) {
    return errorResponse(error, "message policy activation update");
  }
}
