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

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const ribbonConfigSchema = z
  .object({
    enabled: z.boolean(),
    message: z.string(),
    backgroundColor: hexColor,
    textColor: hexColor,
    linkText: z.string(),
    linkHref: z.string(),
    linkColor: hexColor,
  })
  .strict();

/** GET mirrors the public backend setting so preview reads do not need a write scope. */
export async function GET() {
  try {
    return backendJsonResponse(await serverAPIClient.get("/settings/ribbon-config"));
  } catch (error) {
    return errorResponse(error, "fetch ribbon config");
  }
}

export async function PUT(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedResponse("Authentication required. Please log in.");

  const { data, response: invalid } = await parseBody(ribbonConfigSchema, request);
  if (invalid) return invalid;

  try {
    return backendJsonResponse(
      await serverAPIClient.put("/settings/ribbon-config", data, {
        headers: getAuthHeaders(token),
      }),
    );
  } catch (error) {
    return errorResponse(error, "update ribbon config");
  }
}
