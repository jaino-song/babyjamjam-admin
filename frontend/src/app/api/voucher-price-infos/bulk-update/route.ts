import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  localValidationProblemResponse,
  logUpstreamError,
  upstreamStatusProblemResponse,
} from "@/lib/api/route-utils";

/**
 * POST /api/voucher-price-infos/bulk-update
 * 파싱된 바우처 가격 정보 일괄 업데이트
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const body = await request.json();

    // items 배열 검증
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return localValidationProblemResponse([
        {
          pointer: "/items",
          code: "REQUIRED",
          detail: "업데이트할 항목이 없어요.",
          location: "body",
        },
      ]);
    }

    // year 검증
    if (!body.year || typeof body.year !== "number" || body.year < 2000 || body.year > 2100) {
      return localValidationProblemResponse([
        {
          pointer: "/year",
          code: "OUT_OF_RANGE",
          detail: "유효한 연도를 입력해 주세요 (2000-2100).",
          location: "body",
        },
      ]);
    }

    // 백엔드 API 호출
    const response = await serverAPIClient.post(
      "/voucher-price-infos/bulk-update",
      body,
      {
        headers: getAuthHeaders(token),
      },
    );

    return NextResponse.json(response.data);
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;

    // A transport failure has no upstream status: answer with the registered
    // 500 problem instead of a raw Korean body.
    if (!status) {
      logUpstreamError("bulk update voucher price infos", error);
      return upstreamStatusProblemResponse(500, "bulk update voucher price infos", "UNKNOWN");
    }

    // An upstream failure keeps its status; a problem+json body is propagated
    // faithfully, anything else is sanitized to the Korean catalog copy.
    return errorResponse(error, "bulk update voucher price infos", "mutation");
  }
}
