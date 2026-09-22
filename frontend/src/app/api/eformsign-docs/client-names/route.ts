import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
} from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
    try {
        const authToken = getAuthToken(request);
        if (!authToken) {
            return authRequiredResponse();
        }

        const response = await serverAPIClient.get("/eformsign-docs/client-names", {
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            return errorResponse({ response }, "list client names", "read");
        }

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "list client names", "read");
    }
}
