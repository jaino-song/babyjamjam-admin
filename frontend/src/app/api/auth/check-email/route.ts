import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email")?.trim();

    if (!email) {
      return NextResponse.json({ exists: false });
    }

    const { data, status } = await serverAPIClient.get("/auth/check-email", {
      params: { email },
    });

    return NextResponse.json(data, { status });
  } catch (error) {
    return errorResponse(error, "check email availability", "read");
  }
}
