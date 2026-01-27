import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

type RouteParams = { params: Promise<{ id: string }> };

// Helper to get auth token from request
function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

// Helper to create authorization headers
function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * GET /api/file-storage/[id] - Get single document
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const response = await serverAPIClient.get(`/file-storage/${id}`, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error fetching document:", error);

    // axios 에러 처리
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number; data: unknown } };
      if (axiosError.response) {
        return NextResponse.json(
          axiosError.response.data || { error: "문서 조회에 실패했습니다" },
          { status: axiosError.response.status },
        );
      }
    }

    return NextResponse.json(
      { error: "문서 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/file-storage/[id] - Update document metadata
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const response = await serverAPIClient.patch(`/file-storage/${id}`, body, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json(response.data);
  } catch (error) {
    console.error("[API] Error updating document:", error);

    // axios 에러 처리
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number; data: unknown } };
      if (axiosError.response) {
        return NextResponse.json(
          axiosError.response.data || { error: "문서 수정에 실패했습니다" },
          { status: axiosError.response.status },
        );
      }
    }

    return NextResponse.json(
      { error: "문서 수정에 실패했습니다" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/file-storage/[id] - Delete document
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await serverAPIClient.delete(`/file-storage/${id}`, {
      headers: getAuthHeaders(token),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[API] Error deleting document:", error);

    // axios 에러 처리
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number; data: unknown } };
      if (axiosError.response) {
        return NextResponse.json(
          axiosError.response.data || { error: "문서 삭제에 실패했습니다" },
          { status: axiosError.response.status },
        );
      }
    }

    return NextResponse.json(
      { error: "문서 삭제에 실패했습니다" },
      { status: 500 },
    );
  }
}
