import { NextRequest, NextResponse } from "next/server";
import { jwtDecode } from "jwt-decode";
import { serverAPIClient } from "@/lib/api/server";
import {
  backendJsonResponse,
  invalidJsonResponse,
  readJsonObjectBody,
} from "@/lib/api/route-utils";

interface TokenPayload {
  role?: string | null;
}

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

function isOwnerToken(token: string): boolean {
  try {
    return jwtDecode<TokenPayload>(token).role === "owner";
  } catch {
    return false;
  }
}

/**
 * POST /api/voucher-price-infos/bulk-update
 * 파싱된 바우처 가격 정보 일괄 업데이트
 * Owner role only.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!isOwnerToken(token)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonObjectBody(request);

    // items 배열 검증
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "업데이트할 항목이 없습니다" },
        { status: 400 },
      );
    }

    // year 검증
    const year = body.year;
    if (typeof year !== "number" || year < 2000 || year > 2100) {
      return NextResponse.json(
        { error: "유효한 연도를 입력해주세요 (2000-2100)" },
        { status: 400 },
      );
    }

    // 백엔드 API 호출
    const response = await serverAPIClient.post(
      "/voucher-price-infos/bulk-update",
      body,
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

    console.error("[API] Error bulk updating voucher prices:", error);

    // axios 에러 처리
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number; data: unknown } };
      if (axiosError.response) {
        return NextResponse.json(
          axiosError.response.data || { error: "업데이트 실패" },
          { status: axiosError.response.status },
        );
      }
    }

    return NextResponse.json(
      { error: "바우처 가격 정보 업데이트에 실패했습니다" },
      { status: 500 },
    );
  }
}
