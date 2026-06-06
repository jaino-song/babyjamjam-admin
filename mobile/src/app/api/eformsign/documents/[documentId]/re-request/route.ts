import { NextRequest } from "next/server";
import { z } from "zod";

import { proxyPostRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

// Mirrors backend ReRequestOutsiderDocumentRequestDto (eformsign.dto.ts):
// stepType + stepSeq are @IsString() @IsNotEmpty() required; accessToken is
// also required there but proxyPostRequest injects it server-side. comment and
// recipientPhone are optional, so passthrough carries them through unchanged.
const reRequestSchema = z
    .object({
        stepType: z.string().min(1),
        stepSeq: z.string().min(1),
    })
    .passthrough();

export async function POST(request: NextRequest, { params }: RouteParams) {
    const { documentId } = await params;

    return proxyPostRequest(
        request,
        `/api/documents/${encodeURIComponent(documentId)}/re_request_outsider`,
        "re-request eformsign document",
        { bodySchema: reRequestSchema },
    );
}
