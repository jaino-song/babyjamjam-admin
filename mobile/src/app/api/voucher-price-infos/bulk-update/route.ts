import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  getUpstreamErrorStatus,
  invalidJsonResponse,
  readJsonObjectBody,
} from "@/lib/api/route-utils";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

// Mirrors backend BulkUpdateVoucherPriceInfoDto (items: validated array,
// year: @IsNumber()). Preserves the route's prior accept/reject semantics
// exactly: items must be a non-empty array, year an int in 2000-2100. The
// per-field Korean messages and the items-before-year precedence are kept so
// the 400 payloads stay byte-identical to the previous ad-hoc checks.
// readJsonObjectBody (not parseBody) is used so malformed JSON still yields
// the shared "Request body must be valid JSON" 400 and so the field messages
// below can replace parseBody's generic payload.
const bulkUpdateSchema = z
  .object({
    items: z.array(z.unknown()).min(1),
    year: z.number().int().min(2000).max(2100),
  })
  .passthrough();

/**
 * POST /api/voucher-price-infos/bulk-update
 * 파싱된 바우처 가격 정보 일괄 업데이트
 * Backend enforces owner/admin authorization.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await readJsonObjectBody(request);

    const result = bulkUpdateSchema.safeParse(body);
    if (!result.success) {
      // items is validated first (matching the previous check order): if any
      // items issue exists, surface that message; otherwise it is a year issue.
      const hasItemsIssue = result.error.issues.some((issue) => issue.path[0] === "items");
      return NextResponse.json(
        {
          error: hasItemsIssue
            ? "업데이트할 항목이 없습니다"
            : "유효한 연도를 입력해주세요 (2000-2100)",
        },
        { status: 400 },
      );
    }

    // 백엔드 API 호출
    const response = await serverAPIClient.post(
      "/voucher-price-infos/bulk-update",
      result.data,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );

    return backendJsonResponse(response);
  } catch (error) {
    const invalidJson = invalidJsonResponse(error);
    if (invalidJson) return invalidJson;

    const status = getUpstreamErrorStatus(error);
    console.error("[API] Error bulk updating voucher prices:", { status });

    return NextResponse.json(
      { error: "바우처 가격 정보 업데이트에 실패했습니다" },
      { status },
    );
  }
}
