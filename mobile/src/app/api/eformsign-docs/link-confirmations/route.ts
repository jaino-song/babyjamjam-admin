import { NextRequest } from "next/server";

import { getAuthToken, proxyLocalGetRequest } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse, validationProblemResponse } from "@/lib/api/problem-responses";

export async function GET(request: NextRequest) {
  if (!getAuthToken(request)) return unauthorizedProblemResponse();
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (!clientId || !/^[1-9]\d*$/.test(clientId) || !Number.isSafeInteger(Number(clientId))) {
    return validationProblemResponse("clientId must be a positive integer", [
      { pointer: "/clientId", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "query" },
    ]);
  }
  return proxyLocalGetRequest(request, `/eformsign-docs/link-confirmations?clientId=${clientId}`, "fetch contract link confirmations");
}
