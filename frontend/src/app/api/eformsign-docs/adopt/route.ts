import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  localValidationProblemResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return authRequiredResponse();
    const body = await request.json();
    const invalidClientId = body?.clientId !== undefined
      && (!Number.isInteger(body.clientId) || body.clientId < 1);
    if (!body?.documentId || invalidClientId) {
      return localValidationProblemResponse([
        ...(!body?.documentId
          ? [{
            pointer: "/documentId",
            code: "REQUIRED" as const,
            detail: "이관할 문서 식별자가 필요해요.",
            location: "body" as const,
          }]
          : []),
        ...(invalidClientId
          ? [{
            pointer: "/clientId",
            code: "INVALID_VALUE" as const,
            detail: "고객 식별자가 올바르지 않아요.",
            location: "body" as const,
          }]
          : []),
      ]);
    }
    const response = await serverAPIClient.post("/eformsign-docs/adopt", body, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "adopt eformsign document", "mutation");
  }
}
