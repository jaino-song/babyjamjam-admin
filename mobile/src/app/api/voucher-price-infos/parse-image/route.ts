import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { backendJsonResponse, errorResponse } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse, validationProblemResponse } from "@/lib/api/problem-responses";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

/**
 * POST /api/voucher-price-infos/parse-image
 * 바우처 요금표 이미지를 백엔드로 전송하여 Gemini API로 파싱
 * Backend enforces owner/admin authorization.
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedProblemResponse();
    }

    // FormData 추출
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return validationProblemResponse("이미지 파일이 필요합니다", [
        {
          pointer: "/image",
          code: "INVALID_FORMAT",
          detail: "이미지 파일이 필요합니다",
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
        // 큰 파일 처리를 위한 타임아웃 연장
        timeout: 120000,
      },
    );

    return backendJsonResponse(response);
  } catch (error) {
    return errorResponse(error, "parse voucher image");
  }
}
