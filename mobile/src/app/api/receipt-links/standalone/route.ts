import { isAxiosError } from "axios";
import { NextRequest, NextResponse } from "next/server";
import {
  RECEIPT_BRANCH_HEADER,
  readStandaloneReceiptAccepted,
  readStandaloneReceiptRefusal,
} from "@babyjamjam/shared";

import { serverAPIClient } from "@/lib/api/server";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";
import {
  getAuthHeaders,
  getAuthToken,
  invalidJsonResponse,
  logUpstreamError,
  readJsonObjectBody,
  upstreamJsonErrorResponse,
} from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return unauthorizedProblemResponse();

  const expectedBranch = request.headers.get(RECEIPT_BRANCH_HEADER);
  const selectedBranch = request.cookies.get("selected_branch_id")?.value;
  if (expectedBranch !== null && expectedBranch !== selectedBranch) {
    return NextResponse.json({ message: "선택한 지점이 변경되었어요." }, { status: 403 });
  }

  try {
    const { clientId, copaymentReceivedDate, requestId } = await readJsonObjectBody(request);
    const response = await serverAPIClient.post(
      "/receipt-links/standalone",
      { clientId, copaymentReceivedDate, requestId },
      { headers: getAuthHeaders(token) },
    );
    const accepted = readStandaloneReceiptAccepted(response.status, response.data);
    if (accepted) return NextResponse.json(accepted);
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) return invalidJson;
    if (isAxiosError(error) && error.response) {
      const { status, data } = error.response;
      const refusal = readStandaloneReceiptRefusal(status, data);
      if (refusal) return NextResponse.json(refusal, { status });
    }
    logUpstreamError("send standalone receipt", error);
  }

  return upstreamJsonErrorResponse();
}
