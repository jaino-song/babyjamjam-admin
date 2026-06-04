import { NextRequest } from "next/server";

import { proxyPostRequest } from "@/lib/api/route-utils";

export async function POST(request: NextRequest) {
  return proxyPostRequest(
    request,
    "/eformsign-docs/sync-status",
    "sync eformsign document status"
  );
}
