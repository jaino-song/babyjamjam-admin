import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// GET /api/clients/check-phone?phone=01096411878
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const phone = request.nextUrl.searchParams.get("phone");
    if (!phone) {
      return NextResponse.json({ exists: false });
    }

    const targetDigits = phone.replace(/\D/g, "");
    if (targetDigits.length !== 11) {
      return NextResponse.json({ exists: false });
    }

    const response = await serverAPIClient.get("/clients", {
      params: { page: 1, limit: 500 },
      headers: getAuthHeaders(token),
    });

    const clients = Array.isArray(response.data?.data)
      ? (response.data.data as Array<{ phone?: string | null }>)
      : Array.isArray(response.data)
        ? (response.data as Array<{ phone?: string | null }>)
        : [];

    const exists = clients.some(
      (client) => (client.phone ?? "").replace(/\D/g, "") === targetDigits,
    );

    return NextResponse.json({ exists });
  } catch (error) {
    console.error("[API] Error checking phone:", error);
    return NextResponse.json({ exists: false });
  }
}
