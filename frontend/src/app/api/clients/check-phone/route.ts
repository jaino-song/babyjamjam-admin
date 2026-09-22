import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  authRequiredResponse,
  errorResponse,
  getAuthHeaders,
  getAuthToken,
} from "@/lib/api/route-utils";

interface CheckPhoneResponse {
  exists?: boolean;
}

// GET /api/clients/check-phone?phone=01096411878
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return authRequiredResponse();
    }

    const phone = request.nextUrl.searchParams.get("phone");
    if (!phone) {
      return NextResponse.json({ exists: false });
    }

    const targetDigits = phone.replace(/\D/g, "");
    if (targetDigits.length !== 11) {
      return NextResponse.json({ exists: false });
    }

    const response = await serverAPIClient.get<CheckPhoneResponse>("/clients/check-phone", {
      params: { phone: targetDigits },
      headers: getAuthHeaders(token),
    });

    return NextResponse.json({ exists: response.data?.exists === true });
  } catch (error) {
    // A failed lookup is not a negative answer: the caller retries on a
    // non-2xx status and surfaces the failure instead of treating the number
    // as available.
    return errorResponse(error, "check client phone", "read");
  }
}
