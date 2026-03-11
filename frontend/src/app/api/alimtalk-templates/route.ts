import axios from "axios";
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";

function getAuthToken(request: NextRequest): string | null {
  return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    const headers = getAuthHeaders(token);

    const response = contentType.includes("multipart/form-data")
      ? await forwardMultipartRequest(request, headers)
      : await forwardJsonRequest(request, headers);

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error("[API] Error creating alimtalk template:", error);

    if (axios.isAxiosError(error) && error.response) {
      return NextResponse.json(
        error.response.data || { error: "Failed to create alimtalk template" },
        { status: error.response.status },
      );
    }

    return NextResponse.json(
      { error: "Failed to create alimtalk template" },
      { status: 500 },
    );
  }
}

async function forwardJsonRequest(request: NextRequest, headers: Record<string, string>) {
  const body = await request.json();

  return serverAPIClient.post("/alimtalk-templates", body, {
    headers,
  });
}

async function forwardMultipartRequest(request: NextRequest, headers: Record<string, string>) {
  const formData = await request.formData();
  const backendFormData = new FormData();
  const image = formData.get("image");

  if (image instanceof File) {
    const imageBlob = new Blob([await image.arrayBuffer()], { type: image.type });
    backendFormData.append("image", imageBlob, image.name);
  }

  for (const field of ["name", "tplType", "tplEmType", "title", "subtitle", "content", "extra", "advert", "buttons"]) {
    const value = formData.get(field);

    if (typeof value === "string") {
      backendFormData.append(field, value);
    }
  }

  return serverAPIClient.post("/alimtalk-templates", backendFormData, {
    timeout: 120000,
    headers: {
      ...headers,
      "Content-Type": undefined,
    },
  });
}
