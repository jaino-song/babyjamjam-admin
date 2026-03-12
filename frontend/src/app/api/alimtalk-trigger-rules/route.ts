import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const response = await serverAPIClient.get("/alimtalk-trigger-rules", {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error fetching alimtalk trigger rules:", error);
    return NextResponse.json(
      { error: "Failed to fetch alimtalk trigger rules" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const response = await serverAPIClient.post("/alimtalk-trigger-rules", body, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data, { status: 201 });
  } catch (error) {
    console.error("[API] Error creating alimtalk trigger rule:", error);
    return NextResponse.json(
      { error: "Failed to create alimtalk trigger rule" },
      { status: 500 },
    );
  }
}
