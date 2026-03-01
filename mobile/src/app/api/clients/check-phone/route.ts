import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

interface ClientPhone {
  phone?: string | null;
}

interface PaginatedClientsResponse {
  data?: ClientPhone[];
  total?: number;
  page?: number;
  limit?: number;
}

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

    const limit = 500;
    let page = 1;
    let exists = false;

    while (!exists) {
      const response = await serverAPIClient.get<PaginatedClientsResponse | ClientPhone[]>("/clients", {
        params: { page, limit },
        headers: getAuthHeaders(token),
      });

      const payload = response.data;
      const clients = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
          ? payload.data
          : [];

      if (clients.length === 0) {
        break;
      }

      exists = clients.some(
        (client) => (client.phone ?? "").replace(/\D/g, "") === targetDigits,
      );

      if (exists) {
        break;
      }

      if (Array.isArray(payload)) {
        break;
      }

      const total = typeof payload?.total === "number" ? payload.total : undefined;
      const currentPage = typeof payload?.page === "number" ? payload.page : page;

      if (total !== undefined && currentPage * limit >= total) {
        break;
      }

      if (clients.length < limit) {
        break;
      }

      page += 1;
    }

    return NextResponse.json({ exists });
  } catch (error) {
    console.error("[API] Error checking phone:", error);
    return NextResponse.json({ exists: false });
  }
}
