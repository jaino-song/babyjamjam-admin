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

// Mirrors backend DispatchHeadlessRequestDto: contractData is @IsObject()
// required (ContractDataDto is itself an interface, not nested-validated, so the
// proxy only pins object-ness); clientId/progressId are optional. Passthrough
// keeps the contractData shape and any extra fields intact for the backend.
const dispatchHeadlessSchema = z
    .object({
        contractData: z.object({}).passthrough(),
        clientId: z.number().optional(),
        progressId: z.string().optional(),
    })
    .passthrough();

export async function POST(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { data, response: invalid } = await parseBody(dispatchHeadlessSchema, request);
        if (invalid) return invalid;

        const response = await serverAPIClient.post("/eformsign-docs/dispatch-headless", data, {
            headers: getAuthHeaders(token),
            // Headless dispatch can approach 90s when eformsign is slow to fire the SDK
            // success callback; keep the proxy above that ceiling.
            timeout: 180_000,
        });

        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "headless eformsign dispatch");
    }
}
