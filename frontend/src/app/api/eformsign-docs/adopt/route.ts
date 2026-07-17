import { NextRequest, NextResponse } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { errorResponse } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    if (!body?.documentId || (body.clientId !== undefined && (!Number.isInteger(body.clientId) || body.clientId < 1))) {
      return NextResponse.json({ error: "documentId is required" }, { status: 400 });
    }
    const response = await serverAPIClient.post("/eformsign-docs/adopt", body, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    return errorResponse(error, "adopt eformsign document");
  }
}
