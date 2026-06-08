import { NextRequest } from "next/server";
import { z } from "zod";

import { proxyPostRequest } from "@/lib/api/route-utils";

// Mirrors backend SyncEformsignDocStatusDto (eformsign-doc.dto.ts):
// accessToken + documentId are both @IsString() required. proxyPostRequest
// injects accessToken server-side, so the incoming body only needs a
// non-empty documentId. Passthrough preserves forward-compatible fields.
const syncStatusSchema = z
  .object({
    documentId: z.string().min(1),
  })
  .passthrough();

export async function POST(request: NextRequest) {
  return proxyPostRequest(
    request,
    "/eformsign-docs/sync-status",
    "sync eformsign document status",
    { bodySchema: syncStatusSchema }
  );
}
