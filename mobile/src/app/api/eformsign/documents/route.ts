import { NextRequest, NextResponse } from "next/server";
import { proxyDeleteRequest, proxyGetRequest } from "@/lib/api/route-utils";

type IntegerParamOptions = {
    defaultValue: number;
    min: number;
    max?: number;
};

function parseIntegerParam(
    searchParams: URLSearchParams,
    name: string,
    { defaultValue, min, max }: IntegerParamOptions
): { value: number } | { error: string } {
    const rawValue = searchParams.get(name);
    if (rawValue === null) {
        return { value: defaultValue };
    }

    if (!/^-?\d+$/.test(rawValue)) {
        return { error: `${name} must be an integer` };
    }

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) {
        return { error: `${name} must be an integer` };
    }

    if (value < min) {
        return { error: `${name} must be greater than or equal to ${min}` };
    }

    if (max !== undefined && value > max) {
        return { error: `${name} must be between ${min} and ${max}` };
    }

    return { value };
}

/**
 * GET /api/eformsign/documents
 * Unified endpoint to fetch all eformsign documents (in-progress, completed, rejected)
 *
 * Query params:
 * - limit: number of documents to fetch (default: 100)
 * - skip: number of documents to skip for pagination (default: 0)
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const limitResult = parseIntegerParam(searchParams, "limit", {
        defaultValue: 100,
        min: 1,
        max: 100,
    });
    if ("error" in limitResult) {
        return NextResponse.json({ error: limitResult.error }, { status: 400 });
    }

    const skipResult = parseIntegerParam(searchParams, "skip", {
        defaultValue: 0,
        min: 0,
    });
    if ("error" in skipResult) {
        return NextResponse.json({ error: skipResult.error }, { status: 400 });
    }

    const backendParams = new URLSearchParams({
        limit: String(limitResult.value),
        skip: String(skipResult.value),
    });

    return proxyGetRequest(
        request,
        `/api/documents?${backendParams.toString()}`,
        "fetch all eformsign documents"
    );
}

/**
 * DELETE /api/eformsign/documents
 * Delete one or more eformsign documents
 */
export async function DELETE(request: NextRequest) {
    return proxyDeleteRequest(request, "/api/documents", "delete eformsign documents");
}
