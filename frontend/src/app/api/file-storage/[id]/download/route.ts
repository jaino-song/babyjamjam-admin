import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const attachment = searchParams.get("attachment");
    
    const url = attachment === "true"
      ? `/file-storage/${id}/download?attachment=true`
      : `/file-storage/${id}/download`;

    const response = await serverAPIClient.get(url, {
      headers: { authorization: `bearer ${token}` },
      responseType: "arraybuffer",
    });

    return new NextResponse(response.data, {
      headers: {
        "content-type": response.headers["content-type"] || "application/octet-stream",
        "content-disposition": response.headers["content-disposition"] || "inline",
        "content-length": response.headers["content-length"] || String(response.data.byteLength),
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number } };
      if (axiosError.response?.status === 404) {
        return NextResponse.json({ error: "file not found" }, { status: 404 });
      }
    }
    return NextResponse.json({ error: "download failed" }, { status: 500 });
  }
}
