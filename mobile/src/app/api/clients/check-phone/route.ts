import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthToken, getAuthHeaders, NO_STORE_CACHE_CONTROL } from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";

interface CheckPhoneResponse {
  exists?: boolean;
}

const headers = { "Cache-Control": NO_STORE_CACHE_CONTROL };

// GET /api/clients/check-phone
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return unauthorizedProblemResponse();
    }

    const phone = request.nextUrl.searchParams.get("phone");
    if (!phone) {
      return NextResponse.json({ exists: false }, { headers });
    }

    const targetDigits = phone.replace(/\D/g, "");
    if (targetDigits.length !== 11) {
      return NextResponse.json({ exists: false }, { headers });
    }

    const response = await serverAPIClient.get<CheckPhoneResponse>("/clients/check-phone", {
      params: { phone: targetDigits },
      headers: getAuthHeaders(token),
    });

    if (typeof response.data?.exists !== "boolean") {
      throw new Error("Invalid phone check response");
    }

    return NextResponse.json({ exists: response.data.exists }, { headers });
  } catch {
    // Axios errors can contain the authorization header and the queried phone.
    console.error("[API] Error checking phone");
    return NextResponse.json(
      { error: "연락처 중복 여부를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502, headers },
    );
  }
}
