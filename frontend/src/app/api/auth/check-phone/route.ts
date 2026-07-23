import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

export async function GET(request: NextRequest) {
  const phone = request.nextUrl.searchParams.get("phone");
  const targetDigits = (phone ?? "").replace(/\D/g, "");

  if (targetDigits.length !== 11) {
    return NextResponse.json({ exists: false });
  }

  try {
    const { data, status } = await serverAPIClient.get("/auth/check-phone", {
      params: { phone: targetDigits },
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    console.error("[API] Error checking auth phone:", error);
    return NextResponse.json(
      { error: "전화번호 중복 확인에 실패했습니다." },
      { status: 503 },
    );
  }
}
