import type { NextRequest, NextResponse } from "next/server";

import { getServerRuntimeConfig } from "@/lib/env";

export const SERVICE_RECORD_ACCESS_COOKIE = "service_record_access";

const SERVICE_RECORD_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function serviceRecordApiPath(linkToken: string): string {
    return `/api/service-record/${encodeURIComponent(linkToken)}`;
}

export function getServiceRecordAuthorization(request: NextRequest): string {
    const authorization = request.headers.get("authorization");
    if (authorization) return authorization;

    const accessToken = request.cookies.get(SERVICE_RECORD_ACCESS_COOKIE)?.value;
    return accessToken ? `Bearer ${accessToken}` : "";
}

export function setServiceRecordAccessCookie(
    response: NextResponse,
    linkToken: string,
    accessToken: string,
): void {
    response.cookies.set(SERVICE_RECORD_ACCESS_COOKIE, accessToken, {
        httpOnly: true,
        maxAge: SERVICE_RECORD_COOKIE_MAX_AGE_SECONDS,
        path: serviceRecordApiPath(linkToken),
        sameSite: "lax",
        secure: getServerRuntimeConfig().isProductionNodeEnv,
    });
}
