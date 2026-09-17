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
 * POST /api/voucher-price-infos/parse-image
 * 바우처 요금표 이미지를 백엔드로 전송하여 Gemini API로 파싱
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    // FormData 추출
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return localValidationProblemResponse([
        {
          pointer: "/image",
          code: "REQUIRED",
          detail: "파싱할 요금표 이미지가 필요해요.",
          location: "body",
        },
      ]);
    }

    // 파일을 ArrayBuffer로 변환 후 FormData 재구성
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 백엔드로 전송할 FormData 생성
    const backendFormData = new FormData();
    const blob = new Blob([buffer], { type: file.type });
    backendFormData.append("image", blob, file.name);

    // 백엔드 API 호출
    const response = await serverAPIClient.post(
      "/voucher-price-infos/parse-image",
      backendFormData,
      {
        headers: getAuthHeaders(token),
        // 큰 파일 처리를 위한 타임아웃 연장
        timeout: 120000,
      },
    );

    return NextResponse.json(response.data);
  } catch (error) {
    const status = (error as { response?: { status?: number } }).response?.status;

    // A transport failure has no upstream status: answer with the registered
    // 500 problem instead of a raw Korean body.
    if (!status) {
      logUpstreamError("parse voucher price image", error);
      return upstreamStatusProblemResponse(500, "parse voucher price image");
    }

    // An upstream failure keeps its status; a problem+json body is propagated
    // faithfully, anything else is sanitized to the Korean catalog copy.
    return errorResponse(error, "parse voucher price image", "mutation");
  }
}
