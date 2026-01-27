import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

// post /api/file-storage - upload document
export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "파일이 필요합니다" },
        { status: 400 },
      );
    }

    // reconstruct formdata for backend
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const backendFormData = new FormData();
    const blob = new Blob([buffer], { type: file.type });
    backendFormData.append("file", blob, file.name);

    // append metadata fields
    const category = formData.get("category");
    const tags = formData.get("tags");
    const description = formData.get("description");

    if (category) backendFormData.append("category", category as string);
    if (tags) backendFormData.append("tags", tags as string);
    if (description) backendFormData.append("description", description as string);

    const response = await serverAPIClient.post("/file-storage", backendFormData, {
      headers: {
        authorization: `bearer ${token}`,
        "content-type": "multipart/form-data",
      },
      timeout: 120000,
    });

    return NextResponse.json(response.data);
  } catch (error) {
    // handle axios error
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number; data: unknown } };
      if (axiosError.response) {
        return NextResponse.json(
          axiosError.response.data || { error: "업로드 실패" },
          { status: axiosError.response.status },
        );
      }
    }
    return NextResponse.json(
      { error: "파일 업로드에 실패했습니다" },
      { status: 500 },
    );
  }
}

// get /api/file-storage - list documents with optional filters
export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const url = queryString ? `/file-storage?${queryString}` : "/file-storage";

    const response = await serverAPIClient.get(url, {
      headers: { authorization: `bearer ${token}` },
    });

    return NextResponse.json(response.data);
  } catch (error) {
    if (error && typeof error === "object" && "response" in error) {
      const axiosError = error as { response?: { status: number; data: unknown } };
      if (axiosError.response) {
        return NextResponse.json(
          axiosError.response.data,
          { status: axiosError.response.status },
        );
      }
    }
    return NextResponse.json(
      { error: "문서 목록 조회에 실패했습니다" },
      { status: 500 },
    );
  }
}
