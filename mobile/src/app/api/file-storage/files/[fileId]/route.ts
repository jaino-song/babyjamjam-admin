import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    invalidJsonResponse,
    readJsonObjectBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import {
    documentPath,
    invalidFileIdResponse,
    isValidFileId,
} from "../../file-route-utils";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("unauthorized");
    }

    const { fileId } = await params;
    if (!isValidFileId(fileId)) {
        return invalidFileIdResponse();
    }

    try {
        const response = await serverAPIClient.get(documentPath(fileId), {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "fetch document");
    }
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("unauthorized");
    }

    const { fileId } = await params;
    if (!isValidFileId(fileId)) {
        return invalidFileIdResponse();
    }

    try {
        const body = await readJsonObjectBody(request);
        const response = await serverAPIClient.put(documentPath(fileId), body, {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        const invalidJson = invalidJsonResponse(error);
        if (invalidJson) {
            return invalidJson;
        }

        return errorResponse(error, "update document");
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ fileId: string }> }
) {
    const token = getAuthToken(request);
    if (!token) {
        return unauthorizedResponse("unauthorized");
    }

    const { fileId } = await params;
    if (!isValidFileId(fileId)) {
        return invalidFileIdResponse();
    }

    try {
        const response = await serverAPIClient.delete(documentPath(fileId), {
            headers: getAuthHeaders(token),
        });
        return backendJsonResponse(response);
    } catch (error) {
        return errorResponse(error, "delete document");
    }
}
