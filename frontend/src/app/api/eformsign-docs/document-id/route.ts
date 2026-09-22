import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  localValidationProblemResponse,
} from "@/lib/api/route-utils";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const documentId = request.nextUrl.searchParams.get("documentId");
    if (!documentId) {
      return localValidationProblemResponse([
        {
          pointer: "/documentId",
          code: "REQUIRED",
          detail: "문서 식별자가 필요해요.",
          location: "query",
        },
      ]);
    }

    const response = await serverAPIClient.get("/eformsign-docs/document-id", {
      params: { documentId },
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json(response.data);
  } catch (error) {
    return errorResponse(error, "find eformsign doc by document id", "read");
  }
}
