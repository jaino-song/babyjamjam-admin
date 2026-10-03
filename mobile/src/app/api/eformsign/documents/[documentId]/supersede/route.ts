import { NextRequest } from "next/server";
import { z } from "zod";
import { proxyPostRequest } from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ documentId: string }> };

// Mirrors backend SupersedeDocumentRequestDto (eformsign.dto.ts).
const supersedeSchema = z.object({ clientId: z.number().int().positive() });

export async function POST(request: NextRequest, { params }: RouteParams) {
    const { documentId } = await params;

    return proxyPostRequest(
        request,
        `/api/documents/${encodeURIComponent(documentId)}/supersede`,
        "supersede eformsign document",
        { bodySchema: supersedeSchema },
    );
}
