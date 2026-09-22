import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";
import {
    unauthorizedProblemResponse,
    upstreamBodyErrorResponse,
    upstreamUnavailableProblemResponse,
    validationProblemResponse,
} from "@/lib/api/problem-responses";

const BACKEND_URL = BACKEND_BASE_URL;

type IntegerParamOptions = {
    defaultValue: number;
    min: number;
    max?: number;
};

type ParsedIntegerParam = { value: number } | { issue: "INVALID_FORMAT" | "OUT_OF_RANGE"; min: number; max?: number };

function parseIntegerParam(
    searchParams: URLSearchParams,
    name: string,
    { defaultValue, min, max }: IntegerParamOptions
): ParsedIntegerParam {
    const rawValue = searchParams.get(name);
    if (rawValue === null) {
        return { value: defaultValue };
    }

    if (!/^-?\d+$/.test(rawValue)) {
        return { issue: "INVALID_FORMAT", min, max };
    }

    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) {
        return { issue: "INVALID_FORMAT", min, max };
    }

    if (value < min || (max !== undefined && value > max)) {
        return { issue: "OUT_OF_RANGE", min, max };
    }

    return { value };
}

function invalidHistoryParamResponse(name: string, issue: "INVALID_FORMAT" | "OUT_OF_RANGE", min: number, max?: number): NextResponse {
    // `detail` is re-stamped from the shared catalog locale copy by the
    // problem sanitizer; the pointer + code identify the failing parameter.
    return validationProblemResponse(legacyParamError(name, issue, min, max), [{
        pointer: `/${name}`,
        code: issue,
        detail: "입력 형식이 올바르지 않아요.",
        location: "query",
    }]);
}

function legacyParamError(name: string, issue: "INVALID_FORMAT" | "OUT_OF_RANGE", min: number, max?: number): string {
    if (issue === "INVALID_FORMAT") {
        return `${name} must be an integer`;
    }
    return max === undefined
        ? `${name} must be greater than or equal to ${min}`
        : `${name} must be between ${min} and ${max}`;
}

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return unauthorizedProblemResponse();
    }

    const { searchParams } = new URL(request.url);
    const offsetResult = parseIntegerParam(searchParams, "offset", {
        defaultValue: 0,
        min: 0,
    });
    if ("issue" in offsetResult) {
        return invalidHistoryParamResponse("offset", offsetResult.issue, offsetResult.min, offsetResult.max);
    }

    const limitResult = parseIntegerParam(searchParams, "limit", {
        defaultValue: 20,
        min: 1,
        max: 50,
    });
    if ("issue" in limitResult) {
        return invalidHistoryParamResponse("limit", limitResult.issue, limitResult.min, limitResult.max);
    }

    const backendParams = new URLSearchParams({
        offset: String(offsetResult.value),
        limit: String(limitResult.value),
    });

    let backendResponse: Response;
    try {
        backendResponse = await fetch(
            `${BACKEND_URL}/ai/chat/history?${backendParams.toString()}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${authToken.value}`,
                },
            }
        );
    } catch {
        return upstreamUnavailableProblemResponse("read");
    }

    if (!backendResponse.ok) {
        const upstreamText = await backendResponse.text().catch(() => "");
        return upstreamBodyErrorResponse(backendResponse.status, upstreamText, "fetch chat history", "read");
    }

    const data = await backendResponse.json();
    return NextResponse.json(data, { status: backendResponse.status });
}
