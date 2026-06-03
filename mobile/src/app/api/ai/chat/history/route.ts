import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { BACKEND_BASE_URL } from "@/lib/api/server";

const BACKEND_URL = BACKEND_BASE_URL;

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

export async function GET(request: NextRequest) {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token");

    if (!authToken) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const offsetResult = parseIntegerParam(searchParams, "offset", {
        defaultValue: 0,
        min: 0,
    });
    if ("error" in offsetResult) {
        return NextResponse.json({ error: offsetResult.error }, { status: 400 });
    }

    const limitResult = parseIntegerParam(searchParams, "limit", {
        defaultValue: 20,
        min: 1,
        max: 50,
    });
    if ("error" in limitResult) {
        return NextResponse.json({ error: limitResult.error }, { status: 400 });
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
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to fetch chat history";
        return NextResponse.json({ error: errorMessage }, { status: 502 });
    }

    if (!backendResponse.ok) {
        const errorText = await backendResponse.text();
        return NextResponse.json(
            { error: errorText },
            { status: backendResponse.status }
        );
    }

    const data = await backendResponse.json();
    return NextResponse.json(data, { status: backendResponse.status });
}
