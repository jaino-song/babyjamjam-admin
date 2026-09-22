import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

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
    return errorResponse(error, "check phone availability", "read");
  }
}
