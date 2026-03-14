import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

interface UserPhone {
  phone?: string | null;
}

interface PaginatedUsersResponse {
  data?: UserPhone[];
  items?: UserPhone[];
  exists?: boolean;
  phone?: string | null;
}

function normalizePhoneDigits(phone?: string | null) {
  return (phone ?? "").replace(/\D/g, "");
}

function resolvePhoneExists(payload: unknown, targetDigits: string): boolean | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const typedPayload = payload as PaginatedUsersResponse | UserPhone[];

  if (typeof (typedPayload as PaginatedUsersResponse).exists === "boolean") {
    return (typedPayload as PaginatedUsersResponse).exists ?? false;
  }

  if (Array.isArray(typedPayload)) {
    return typedPayload.some((user) => normalizePhoneDigits(user.phone) === targetDigits);
  }

  const paginatedUsers = Array.isArray(typedPayload.data)
    ? typedPayload.data
    : Array.isArray(typedPayload.items)
      ? typedPayload.items
      : null;

  if (paginatedUsers) {
    return paginatedUsers.some((user) => normalizePhoneDigits(user.phone) === targetDigits);
  }

  if ("phone" in typedPayload) {
    return normalizePhoneDigits(typedPayload.phone) === targetDigits;
  }

  return null;
}

// GET /api/auth/check-phone?phone=01012345678
export async function GET(request: NextRequest) {
  try {
    const phone = request.nextUrl.searchParams.get("phone");
    const targetDigits = normalizePhoneDigits(phone);

    if (targetDigits.length !== 11) {
      return NextResponse.json({ exists: false });
    }

    const candidates: Array<{ path: string; params?: Record<string, string> }> = [
      { path: "/users", params: { phone: targetDigits } },
      { path: "/users/phone", params: { phone: targetDigits } },
      { path: "/users" },
    ];

    for (const candidate of candidates) {
      try {
        const response = await serverAPIClient.get(candidate.path, {
          params: candidate.params,
        });

        if (response.status >= 400) {
          continue;
        }

        const exists = resolvePhoneExists(response.data, targetDigits);
        if (exists !== null) {
          return NextResponse.json({ exists });
        }
      } catch {
        continue;
      }
    }

    return NextResponse.json({ exists: false });
  } catch (error) {
    console.error("[API] Error checking auth phone:", error);
    return NextResponse.json({ exists: false });
  }
}
