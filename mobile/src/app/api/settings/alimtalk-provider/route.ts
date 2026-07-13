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

// Mirrors backend UpdateAlimtalkProviderDto: provider is @IsString()
// @IsNotEmpty() @IsIn(ALIMTALK_PROVIDERS) required. The provider enum mirrors
// backend ALIMTALK_PROVIDERS = ["aligo_alimtalk", "none"]. Passthrough
// preserves any forward-compatible fields.
const updateAlimtalkProviderSchema = z
    .object({
        provider: z.enum(["aligo_alimtalk", "none"]),
    })
    .passthrough();

export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const response = await serverAPIClient.get("/settings/alimtalk-provider", {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch alimtalk provider");
    }
}

export async function PUT(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) {
            return unauthorizedResponse("Unauthorized");
        }

        const { data, response: invalid } = await parseBody(updateAlimtalkProviderSchema, request);
        if (invalid) {
            return invalid;
        }

        const response = await serverAPIClient.put("/settings/alimtalk-provider", data, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "update alimtalk provider");
    }
}
