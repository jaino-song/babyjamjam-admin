import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  localValidationProblemResponse,
} from "@/lib/api/route-utils";

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

export async function GET(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return authRequiredResponse();
        }

        const clientId = request.nextUrl.searchParams.get("clientId");
        if (clientId === "") {
            return localValidationProblemResponse([
                {
                    pointer: "/clientId",
                    code: "REQUIRED",
                    detail: "고객 식별자가 필요해요.",
                    location: "query",
                },
            ]);
        }
        if (clientId !== null && !POSITIVE_INTEGER_PATTERN.test(clientId)) {
            return localValidationProblemResponse([
                {
                    pointer: "/clientId",
                    code: "INVALID_FORMAT",
                    detail: "고객 식별자 형식이 올바르지 않아요.",
                    location: "query",
                },
            ]);
        }

        const response = await serverAPIClient.get("/eformsign-docs/link-confirmations", {
            ...(clientId === null ? {} : { params: { clientId } }),
            headers: getAuthHeaders(authToken),
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "list eformsign link confirmations by client", "read");
    }
}
