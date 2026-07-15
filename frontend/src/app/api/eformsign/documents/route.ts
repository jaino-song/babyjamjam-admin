import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
    errorResponse,
    getAccessToken,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
} from "@/lib/api/route-utils";
import { serverAPIClient } from "@/lib/api/server";

const DOCUMENT_LIST_CACHE_TTL_MS = 30 * 1000;
const DOCUMENT_LIST_CACHE_MAX_ENTRIES = 50;

type DocumentListCacheEntry = {
    expiresAt: number;
    data: unknown;
};

const documentListCache = new Map<string, DocumentListCacheEntry>();

function hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function getDocumentListCacheKey(params: {
    authToken: string;
    accessToken: string;
    backendPath: string;
    limit: string;
    skip: string;
}): string {
    return [
        hashToken(params.authToken),
        hashToken(params.accessToken),
        params.backendPath,
        params.limit,
        params.skip,
    ].join(":");
}

function pruneDocumentListCache() {
    const now = Date.now();
    for (const [key, entry] of documentListCache) {
        if (entry.expiresAt <= now) {
            documentListCache.delete(key);
        }
    }

    while (documentListCache.size > DOCUMENT_LIST_CACHE_MAX_ENTRIES) {
        const oldestKey = documentListCache.keys().next().value;
        if (!oldestKey) break;
        documentListCache.delete(oldestKey);
    }
}

function clearDocumentListCacheForTokens(authToken: string, accessToken: string) {
    const tokenPrefix = `${hashToken(authToken)}:${hashToken(accessToken)}:`;
    for (const key of documentListCache.keys()) {
        if (key.startsWith(tokenPrefix)) {
            documentListCache.delete(key);
        }
    }
}

/**
 * GET /api/eformsign/documents
 * Unified endpoint to fetch all eformsign documents (in-progress, completed, expired)
 *
 * Query params:
 * - limit: number of documents to fetch (default: 100)
 * - skip: number of documents to skip for pagination (default: 0)
 */
export async function GET(request: NextRequest) {
    const authToken = getAuthToken(request);
    const accessToken = getAccessToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    if (!accessToken) {
        return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
    }

    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "100";
    const skip = searchParams.get("skip") || "0";
    const type = searchParams.get("type");

    const backendPathByType: Record<string, string> = {
        "in-progress": "/api/documents/in-progress",
        completed: "/api/documents/completed",
        expired: "/api/documents/rejected",
        // Deprecated alias for old callers. New UI filters use "expired".
        rejected: "/api/documents/rejected",
    };

    const backendPath = type && backendPathByType[type]
        ? backendPathByType[type]
        : "/api/documents";

    const cacheKey = getDocumentListCacheKey({
        authToken,
        accessToken,
        backendPath,
        limit,
        skip,
    });
    const now = Date.now();
    const cached = documentListCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
        return NextResponse.json(cached.data);
    }

    try {
        const response = await serverAPIClient.get(`${backendPath}?limit=${limit}&skip=${skip}`, {
            params: { accessToken },
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        pruneDocumentListCache();
        documentListCache.set(cacheKey, {
            expiresAt: now + DOCUMENT_LIST_CACHE_TTL_MS,
            data: response.data,
        });

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "fetch all eformsign documents");
    }
}

export async function DELETE(request: NextRequest) {
    const authToken = getAuthToken(request);
    const accessToken = getAccessToken(request);

    if (!authToken) {
        return unauthorizedResponse("Authentication required. Please log in.");
    }

    if (!accessToken) {
        return unauthorizedResponse("eFormsign access token required. Please authenticate with eFormsign first.");
    }

    try {
        const { searchParams } = new URL(request.url);
        const isPermanent = searchParams.get("is_permanent") || "false";
        const body = await request.json().catch(() => ({}));

        const response = await serverAPIClient.delete("/api/documents", {
            params: {
                accessToken,
                is_permanent: isPermanent,
            },
            data: body,
            headers: getAuthHeaders(authToken),
        });

        if (response.status >= 400) {
            const errorMessage = response.data?.error || response.data?.message || `Backend returned ${response.status}`;
            return NextResponse.json({ error: errorMessage }, { status: response.status });
        }

        clearDocumentListCacheForTokens(authToken, accessToken);

        return NextResponse.json(response.data);
    } catch (error) {
        return errorResponse(error, "delete eformsign documents");
    }
}
