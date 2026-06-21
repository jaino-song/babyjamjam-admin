import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

type RouteParams = { params: Promise<{ id: string }> };

const newClientShape = z.object({
    fields: z
        .object({
            name: z.string().min(1).max(10_000),
            careCenter: z.boolean(),
            voucherClient: z.boolean(),
            breastPump: z.boolean(),
        })
        .passthrough(),
    suppressGreetingSms: z.boolean().optional(),
});

const clientUpdateShape = z
    .object({
        changes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    })
    .refine(
        (obj) => Object.keys(obj.changes).length > 0,
        { message: "변경 사항이 없습니다." },
    );

const confirmDraftSchema = z.union([newClientShape, clientUpdateShape]);

// POST /api/client-drafts/[id]/confirm - 초안 확정 (backend 409/501 status preserved)
export async function POST(request: NextRequest, { params }: RouteParams) {
    const token = getAuthToken(request);
    if (!token) return unauthorizedResponse("Unauthorized");

    const { id } = await params;

    const { data, response } = await parseBody(confirmDraftSchema, request);
    if (response) return response;

    try {
        const backendResponse = await serverAPIClient.post(
            `/client-drafts/${encodeURIComponent(id)}/confirm`,
            data,
            { headers: getAuthHeaders(token) },
        );
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "confirm client draft");
    }
}
