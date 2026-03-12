import { NextRequest } from "next/server";
import { proxyGetRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { documentId } = await params;

  return proxyGetRequest(
    request,
    `/api/documents/${documentId}`,
    "fetch eformsign document detail"
  );
}
