import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

// Helper: 요청에서 토큰 추출
function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

/**
 * POST /api/voucher-price-infos/parse-image
 * 바우처 요금표 이미지를 백엔드로 전송하여 Gemini API로 파싱
 */
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // FormData 추출
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "이미지 파일이 필요합니다" },
        { status: 400 },
      );
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
          "Content-Type": "multipart/form-data",
        },
        // 큰 파일 처리를 위한 타임아웃 연장
        timeout: 120000,
      },
    );

    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error parsing voucher image:", error);

    // axios 에러 처리
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number; data: unknown } };
      if (axiosError.response) {
        return NextResponse.json(
          axiosError.response.data || { error: "파싱 실패" },
          { status: axiosError.response.status },
        );
      }
    }

    return NextResponse.json(
      { error: "바우처 이미지 파싱에 실패했습니다" },
      { status: 500 },
    );
  }
}
