import { NextRequest, NextResponse } from "next/server";

import { errorResponse, getAuthHeaders, getAuthToken } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";
import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  const authToken = getAuthToken(request);

  if (!authToken) {
    return unauthorizedProblemResponse();
  }

  try {
    const response = await serverAPIClient.get("/eformsign-docs/feedback-template-id", {
      headers: getAuthHeaders(authToken),
    });

    if (response.status >= 400) {
      // Defensive branch: validateStatus rejects everything >= 400 upstream, so
      // this only fires if the resolved-response contract changes. Route it
      // through the shared problem boundary instead of authoring a raw body:
      // a verbatim upstream problem body is forwarded, anything else gets the
      // sanitized Korean fallback, and the upstream status is preserved.
      return errorResponse(
        { response: { status: response.status, data: response.data } },
        "get service record template id",
        "read",
      );
    }

    return NextResponse.json(response.data);
  } catch (error) {
    return errorResponse(error, "get service record template id");
  }
}
