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

// Mirrors backend CreateEformsignDocLocalDto: documentId/clientId and the
// status/step strings are all @IsString()/@IsNumber() required; expiredDate is
// @IsDateString(); linkToClient is the only optional field. Passthrough keeps
// any forward-compatible fields flowing to the backend ValidationPipe.
const createEformsignDocSchema = z
    .object({
        documentId: z.string(),
        clientId: z.number(),
        statusType: z.string(),
        statusDetail: z.string(),
        stepType: z.string(),
        stepIndex: z.string(),
        stepName: z.string(),
        stepRecipientType: z.string(),
        stepRecipientName: z.string(),
        stepRecipientSms: z.string(),
        expiredDate: z.string(),
        linkToClient: z.boolean().optional(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { data, response: invalid } = await parseBody(createEformsignDocSchema, request);
        if (invalid) return invalid;

        const response = await serverAPIClient.post("/eformsign-docs", data, {
            headers: getAuthHeaders(token),
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "create eformsign doc record");
    }
}
