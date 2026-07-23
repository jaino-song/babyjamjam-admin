import { NextRequest } from "next/server";
import { z } from "zod";

import { proxyPostRequest } from "@/lib/api/route-utils";

const syncStatusSchema = z
    .object({
        documentId: z.string().min(1),
    });

export async function POST(request: NextRequest) {
    return proxyPostRequest(
        request,
        "/eformsign-docs/sync-status",
        "sync eformsign document status",
        { bodySchema: syncStatusSchema },
    );
}
