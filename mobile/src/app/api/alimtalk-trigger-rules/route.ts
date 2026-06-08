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

// Mirrors backend CreateAlimtalkTriggerRuleDto: name, eventType, offsetType,
// recipientType and templateKey are required enums; optional fields passthrough.
const createTriggerRuleSchema = z
  .object({
    name: z.string().min(1),
    eventType: z.enum([
      "CLIENT_CREATED",
      "SERVICE_START",
      "SERVICE_END",
      "EMPLOYEE_ASSIGNED",
    ]),
    offsetType: z.enum(["IMMEDIATE", "SAME_DAY", "BEFORE_DAYS", "AFTER_DAYS"]),
    recipientType: z.enum([
      "CLIENT",
      "PRIMARY_EMPLOYEE",
      "SECONDARY_EMPLOYEE",
    ]),
    templateKey: z.enum([
      "CLIENT_WELCOME",
      "SERVICE_START_REMINDER",
      "SERVICE_INFO",
      "SERVICE_END_REMINDER",
      "EMPLOYEE_ASSIGNED",
    ]),
  })
  .passthrough();

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const response = await serverAPIClient.get("/alimtalk-trigger-rules", {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "fetch alimtalk trigger rules");
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { data, response: invalidBody } = await parseBody(
      createTriggerRuleSchema,
      request,
    );
    if (invalidBody) {
      return invalidBody;
    }

    const response = await serverAPIClient.post("/alimtalk-trigger-rules", data, {
      headers: getAuthHeaders(token),
    });
    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "create alimtalk trigger rule");
  }
}
