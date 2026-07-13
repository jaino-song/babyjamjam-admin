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

// Mirrors backend CreateAlimtalkTemplateDto: name, tplType, tplEmType,
// content and buttons are required; optional fields flow through passthrough.
const createAlimtalkTemplateSchema = z
  .object({
    name: z.string().min(1).max(30),
    tplType: z.enum(["BA", "EX", "AD", "MI"]),
    tplEmType: z.enum(["NONE", "TEXT", "IMAGE"]),
    content: z.string().min(1).max(1000),
    buttons: z.array(z.unknown()).max(5),
  })
  .passthrough();

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedResponse("Unauthorized");
  }

  try {
    const response = await serverAPIClient.get("/alimtalk-templates", {
      headers: getAuthHeaders(token),
    });

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "fetch alimtalk templates");
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedResponse("Unauthorized");
    }

    const { data, response: invalidBody } = await parseBody(
      createAlimtalkTemplateSchema,
      request,
    );
    if (invalidBody) {
      return invalidBody;
    }

    const response = await serverAPIClient.post("/alimtalk-templates", data, {
      headers: getAuthHeaders(token),
    });

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "create alimtalk template");
  }
}
