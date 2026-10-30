/**
 * @jest-environment jsdom
 */
import { getQueryClient } from "@/lib/queryClient";
import { AUTH_USER_QUERY_KEY } from "@/hooks/useGetAuthUser";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { knownDefect, invariant } from "./client-known-defect";

const ACTIVE_ADMIN_USER = {
    id: "user-1",
    name: "홍관리",
    role: "admin",
    branchId: "branch-1",
};

function withProtectedLocation<T>(run: (location: { href: string; pathname: string }) => Promise<T>): Promise<T> {
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    const location = { pathname: "/dashboard", href: "http://localhost/dashboard" };
    Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
    });
    return run(location).finally(() => {
        if (originalLocation) {
            Object.defineProperty(window, "location", originalLocation);
        }
    });
}

function stubResponse(status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response {
    // jest-environment-jsdom (29) does not provide the fetch Response object, so the
    // stubbed HTTP layer returns the minimal shape the auth code reads.
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        headers: {
            get: (name: string) => headers?.[name.toLowerCase()] ?? null,
        },
    } as unknown as Response;
}

describe("SI-USER-08 mobile session authority integrity (real authority reset, HTTP layer mocked)", () => {
    let client: ReturnType<typeof getQueryClient>;
    let fetchMock: jest.Mock;
    let originalFetch: typeof fetch | undefined;

    beforeEach(() => {
        client = getQueryClient();
        client.clear();
        window.history.replaceState({}, "", "/dashboard");
        fetchMock = jest.fn();
        originalFetch = global.fetch;
        global.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        if (originalFetch === undefined) {
            delete (globalThis as { fetch?: unknown }).fetch;
        } else {
            global.fetch = originalFetch;
        }
        client.clear();
    });

    invariant(
        "SI-USER-08",
        "a terminal 401 resets the authority state and routes to /login",
        async () => {
        // The protected call 401s; the session refresh 401s too — the refresh wrapper
        // treats the session as dead: resetAuthorityState + redirect to /login.
        fetchMock.mockImplementation(async (input: RequestInfo) => {
            if (String(input) === "/api/auth/refresh") {
                return stubResponse(401, { code: "AUTH_REFRESH_INVALID" });
            }
            return stubResponse(401, { code: "AUTH_REQUIRED" });
        });
        client.setQueryData(AUTH_USER_QUERY_KEY, ACTIVE_ADMIN_USER);

        await withProtectedLocation(async (location) => {
            await expect(authenticatedFetch("/api/clients")).rejects.toMatchObject({
                name: "ApplicationSessionRefreshError",
            });
            // The cached admin authority is gone and the app left the protected shell.
            expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeUndefined();
            expect(location.href).toBe("/login");
        });
    });

    // If this starts failing because the fix landed (403 now triggers an authority
    // reset or an auth-user re-fetch), flip this call to a plain `invariant`.
    knownDefect(
        "SI-USER-08",
        "a 403 caused by a server-side role change re-fetches the cached authority",
        async () => {
            // The user was demoted on the server; their cached /auth/me response still
            // claims admin. Their next protected call answers 403. authenticatedFetch
            // must surface the 403 unchanged — and the RIGHT behavior is that the 403
            // caused by the role change also invalidates the cached authority, so the
            // next render re-fetches /auth/me instead of serving the stale admin
            // identity for the remaining 30-minute staleTime.
            fetchMock.mockImplementation(async () => stubResponse(403, { code: "ACCESS_DENIED" }));
            client.setQueryData(AUTH_USER_QUERY_KEY, ACTIVE_ADMIN_USER);

            const response = await authenticatedFetch("/api/clients");
            expect(response.status).toBe(403);

            // The CORRECT invariant:
            const state = client.getQueryState(AUTH_USER_QUERY_KEY);
            const invalidated = state?.isInvalidated ?? false;
            if (invalidated || client.getQueryData(AUTH_USER_QUERY_KEY) === undefined) {
                return; // invariant holds (fix landed)
            }

            throw new Error(
                "SI-USER-08: a 403 ACCESS_DENIED on a protected mobile API left the cached authUser query intact " +
                    `(isInvalidated=${String(state?.isInvalidated ?? "absent")}, data still present) — ` +
                    "authenticatedFetch triggers no authority re-fetch/reset on 403",
            );
        },
        "SI-USER-08: a 403 ACCESS_DENIED on a protected mobile API left the cached authUser query intact",
    );

    invariant("SI-USER-08", "the mobile auth user query serves from a 30-minute staleTime (severity enabler, recorded)", () => {
        const source = require("fs").readFileSync(
            require("path").join(__dirname, "..", "..", "hooks", "useGetAuthUser.ts"),
            "utf8",
        );
        expect(source).toContain("staleTime: 1000 * 60 * 30");
        expect(source).toContain("retry: false");
    });
});
