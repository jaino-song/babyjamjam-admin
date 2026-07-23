import { NextRequest } from "next/server";
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

const ENDPOINT = "/settings/client-registration-policy";
const policyPatchSchema = z.object({
  clientAutoRegistration: z.boolean().optional(),
  greetingOnAutoRegistration: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one setting is required");

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  try {
    return backendJsonResponse(await serverAPIClient.get(ENDPOINT, { headers: getAuthHeaders(token) }));
  } catch (error) {
    return errorResponse(error, "client registration policy fetch");
  }
}

export async function PUT(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Unauthorized");

  const { data, response: invalid } = await parseBody(policyPatchSchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(await serverAPIClient.put(ENDPOINT, data, { headers: getAuthHeaders(token) }));
  } catch (error) {
    return errorResponse(error, "client registration policy update");
  }
}
