import axios from "axios";
import type { AxiosError, AxiosRequestConfig } from "axios";

const AUTH_USER_QUERY_KEY = ["authUser"] as const;

type AxiosMockInternals = {
    requestInterceptorUse: jest.Mock;
    responseInterceptorUse: jest.Mock;
    apiPost: jest.Mock;
    barePost: jest.Mock;
};
type AxiosFunctionMock = jest.Mock & {
    create: jest.Mock;
    post: jest.Mock;
    __mockApi: AxiosMockInternals;
};

// Only the HTTP transport is mocked: the api client module below registers its
// real response interceptor, and resetAuthorityState runs for real against the
// real browser QueryClient singleton.
jest.mock("axios", () => {
    const requestInterceptorUse = jest.fn();
    const responseInterceptorUse = jest.fn();
    const apiPost = jest.fn();
    const barePost = jest.fn();
    const mockAxios = jest.fn() as AxiosFunctionMock;
    mockAxios.post = barePost;
    mockAxios.create = jest.fn(() => ({
        interceptors: {
            request: { use: requestInterceptorUse },
            response: { use: responseInterceptorUse },
        },
        post: apiPost,
    }));
    mockAxios.__mockApi = {
        requestInterceptorUse,
        responseInterceptorUse,
        apiPost,
        barePost,
    };
    return {
        __esModule: true,
        default: mockAxios,
    };
});

import { getQueryClient } from "@/lib/queryClient";
import "@/lib/api/client";
import { invariant } from "./client-known-defect";

type RetryableRequestConfig = AxiosRequestConfig & {
    _retry?: boolean;
    _appAuthRetry?: boolean;
};
const mockAxios = axios as unknown as AxiosFunctionMock;

/** getResponseRejectedHandler — mirrors frontend/src/lib/api/__tests__/client.test.ts. */
function getResponseRejectedHandler(): (err: AxiosError) => Promise<unknown> {
    const rejectedHandler = mockAxios.__mockApi.responseInterceptorUse.mock.calls[0]?.[1];
    if (!rejectedHandler) {
        throw new Error("Response interceptor was not registered");
    }
    return rejectedHandler as (err: AxiosError) => Promise<unknown>;
}

function createResponseError(status: number, body: Record<string, unknown>): AxiosError {
    return {
        name: "AxiosError",
        message: `Request failed with status code ${status}`,
        config: { method: "GET", url: "/clients" } as RetryableRequestConfig,
        response: { status, data: body },
        isAxiosError: true,
        toJSON: () => ({}),
    } as AxiosError;
}

function withProtectedLocation<T>(run: () => Promise<T>): Promise<T> {
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    const location = { pathname: "/dashboard", href: "http://localhost/dashboard" };
    Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
    });
    return run().finally(() => {
        if (originalLocation) {
            Object.defineProperty(window, "location", originalLocation);
        }
    });
}

const ACTIVE_ADMIN_USER = {
    id: "user-1",
    name: "홍관리",
    role: "admin",
    branchRole: "admin",
    branchId: "branch-1",
};

describe("SI-USER-08 desktop authority state integrity (real QueryClient, HTTP layer mocked)", () => {
    let client: ReturnType<typeof getQueryClient>;

    beforeEach(() => {
        mockAxios.mockClear();
        mockAxios.__mockApi.barePost.mockReset();
        client = getQueryClient();
        client.clear();
    });

    afterEach(() => {
        client.clear();
    });

    invariant(
        "SI-USER-08",
        "a terminal 401 clears the cached authority (authUser) through resetAuthorityState",
        async () => {
        // Refresh fails terminally (session gone — e.g. server-side session revocation
        // after a role/membership change), so the interceptor must route the request
        // to redirectToLoginOnce.
        mockAxios.__mockApi.barePost.mockRejectedValue(createResponseError(401, { error: "Unauthorized" }));
        client.setQueryData(AUTH_USER_QUERY_KEY, ACTIVE_ADMIN_USER);

        await withProtectedLocation(async () => {
            const rejection = getResponseRejectedHandler()(
                createResponseError(401, { code: "AUTH_REQUIRED" }),
            );
            await expect(rejection).rejects.toBeDefined();
        });

        // The cached admin authority is gone; the next render re-fetches /auth/me
        // instead of rendering the previously cached admin capabilities.
        expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeUndefined();
    });

    invariant(
        "SI-USER-08",
        "a 403 caused by a server-side role change re-fetches the cached authority",
        async () => {
            // The user was demoted on the server; their cached /auth/me response still
            // claims admin. Their next admin API call answers 403 ACCESS_DENIED.
            const demotion403 = createResponseError(403, {
                code: "ACCESS_DENIED",
                params: {},
                outcome: "NOT_APPLIED",
            });
            client.setQueryData(AUTH_USER_QUERY_KEY, ACTIVE_ADMIN_USER);

            await withProtectedLocation(async () => {
                // The interceptor must surface the 403 to the caller unchanged.
                const rejection = getResponseRejectedHandler()(demotion403);
                await expect(rejection).rejects.toBe(demotion403);
            });

            // The CORRECT invariant: the 403 caused by the role change must invalidate
            // the cached authority so the next render re-fetches /auth/me — the UI must
            // not keep serving the stale admin identity for the remaining staleTime
            // (30 minutes in useGetAuthUser).
            const state = client.getQueryState(AUTH_USER_QUERY_KEY);
            const stillRefreshing = state?.isInvalidated ?? false;
            const stillCached = client.getQueryData(AUTH_USER_QUERY_KEY);
            if (stillRefreshing || stillCached === undefined) {
                return; // invariant holds (fix landed)
            }

            throw new Error(
                "SI-USER-08: a 403 ACCESS_DENIED on a protected API left the cached authUser query intact " +
                    `(isInvalidated=${String(state?.isInvalidated ?? "absent")}, data still present) — ` +
                    "the interceptor triggers no authority re-fetch/reset on 403, so the UI keeps showing " +
                    "the pre-demotion admin identity until the next 401 or manual refetch",
            );
        },
    );

    // NOTE: the former source-grep contracts for the branch-switch reset and the
    // 30-minute staleTime were REPLACED by behavioural tests in
    // ./desktop-branch-switch.client-integrity.test.tsx (real page render against
    // the real shared QueryClient; real useGetAuthUser staleness behaviour).
});
