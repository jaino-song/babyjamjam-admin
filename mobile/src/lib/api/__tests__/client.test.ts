import { AxiosError } from "axios";

import { resetAuthorityState } from "@/lib/auth/authority-state";
import { captureServiceRecordError } from "@/lib/observability/capture-service-record-error";

import {
    api,
    isEformsignTokenEndpoint,
} from "../client";
import { authenticatedFetch } from "../authenticated-fetch";

jest.mock("@/lib/observability/capture-service-record-error", () => ({
    captureServiceRecordError: jest.fn(),
}));

jest.mock("@/lib/auth/authority-state", () => ({
    resetAuthorityState: jest.fn(),
}));

const mockCaptureServiceRecordError = jest.mocked(captureServiceRecordError);
const mockResetAuthorityState = jest.mocked(resetAuthorityState);

describe("isEformsignTokenEndpoint", () => {
    it.each([
        "/eformsign/documents",
        "/eformsign/documents/doc-1",
        "/eformsign/documents/doc-1/re-request",
        "/eformsign-docs",
        "/eformsign-docs/client-names",
        "/eformsign-docs/dispatch-headless",
        "/eformsign-docs/finalize-headless",
        "/generate-document",
        "/generate-staff-document",
        "/generate-signature",
        "/access-token",
        "/refresh-access-token",
    ])("classifies %s as eformsign token-backed", (url) => {
        expect(isEformsignTokenEndpoint(url)).toBe(true);
    });

    it.each([
        "/auth/login",
        "/auth/refresh",
        "/employees",
        "/file-storage/files",
        "/document-categories",
        undefined,
    ])("does not classify %s as eformsign token-backed", (url) => {
        expect(isEformsignTokenEndpoint(url)).toBe(false);
    });
});

describe("service-record API error monitoring", () => {
    const originalAdapter = api.defaults.adapter;

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
        mockCaptureServiceRecordError.mockReset();
    });

    it("captures a service-record network failure once after the retry is exhausted", async () => {
        const adapter = jest.fn(async (config) => {
            throw new AxiosError("Network Error", "ERR_NETWORK", config);
        });
        api.defaults.adapter = adapter;

        await expect(api.get("/admin/service-records/client/42")).rejects.toMatchObject({
            code: "ERR_NETWORK",
        });

        expect(adapter).toHaveBeenCalledTimes(2);
        expect(mockCaptureServiceRecordError).toHaveBeenCalledTimes(1);
        expect(mockCaptureServiceRecordError).toHaveBeenCalledWith(
            expect.objectContaining({
                code: "ERR_NETWORK",
                config: expect.objectContaining({
                    method: "get",
                    url: "/admin/service-records/client/42",
                }),
            }),
        );
    });

    it("does not retry a mutation when the network result is ambiguous", async () => {
        const adapter = jest.fn(async (config) => {
            throw new AxiosError("Network Error", "ERR_NETWORK", config);
        });
        api.defaults.adapter = adapter;

        await expect(
            api.post("/message-deliveries/sms", {
                receiver: "01000000000",
                message: "test",
            }),
        ).rejects.toMatchObject({ code: "ERR_NETWORK" });

        expect(adapter).toHaveBeenCalledTimes(1);
    });

    it("captures a resolved service-record 5xx failure without retrying", async () => {
        const adapter = jest.fn(async (config) => {
            throw new AxiosError(
                "Request failed with status code 503",
                "ERR_BAD_RESPONSE",
                config,
                undefined,
                {
                    status: 503,
                    statusText: "Service Unavailable",
                    headers: {},
                    config,
                    data: {},
                },
            );
        });
        api.defaults.adapter = adapter;

        await expect(api.get("/admin/service-records/client/42")).rejects.toMatchObject({
            response: expect.objectContaining({ status: 503 }),
        });

        expect(adapter).toHaveBeenCalledTimes(1);
        expect(mockCaptureServiceRecordError).toHaveBeenCalledTimes(1);
    });
});

describe("application-session 401 recovery", () => {
    const originalAdapter = api.defaults.adapter;
    const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
    const originalFetch = global.fetch;

    afterEach(() => {
        api.defaults.adapter = originalAdapter;
        global.fetch = originalFetch;
        mockResetAuthorityState.mockReset();
        if (originalLocation) {
            Object.defineProperty(window, "location", originalLocation);
        }
    });

    it("shares one application refresh across concurrent Axios, eformsign, and native fetch requests", async () => {
        let sessionRefreshed = false;
        let nativeFetchAttempts = 0;
        const response = (status: number, data: unknown): Response => ({
            ok: status >= 200 && status < 300,
            status,
            headers: { get: () => null },
            clone() {
                return response(status, data);
            },
            json: async () => data,
        } as unknown as Response);
        const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
            if (input === "/api/auth/refresh") {
                await new Promise((resolve) => setTimeout(resolve, 10));
                sessionRefreshed = true;
                return response(204, null);
            }

            nativeFetchAttempts += 1;
            return sessionRefreshed
                ? response(200, { success: true })
                : response(401, { code: "AUTH_REFRESH_REQUIRED" });
        });
        global.fetch = fetchMock;
        const adapter = jest.fn(async (config) => {
            if (config.url === "/refresh-access-token") {
                throw new Error("application session recovery must not refresh eformsign credentials");
            }

            if (!sessionRefreshed) {
                throw new AxiosError(
                    "Request failed with status code 401",
                    "ERR_BAD_RESPONSE",
                    config,
                    undefined,
                    {
                        status: 401,
                        statusText: "Unauthorized",
                        headers: {},
                        config,
                        data: {
                            code: "AUTH_REFRESH_REQUIRED",
                            error: "Session refresh required",
                        },
                    },
                );
            }

            return {
                config,
                data: { success: true },
                headers: {},
                status: 200,
                statusText: "OK",
            };
        });
        api.defaults.adapter = adapter;

        const results = await Promise.allSettled([
            api.get("/clients"),
            api.get("/eformsign-docs/client-names"),
            authenticatedFetch("/api/notifications"),
        ]);

        expect(results.map((result) => result.status)).toEqual([
            "fulfilled",
            "fulfilled",
            "fulfilled",
        ]);

        expect(fetchMock.mock.calls.filter(([input]) => (
            input === "/api/auth/refresh"
        ))).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith("/api/auth/refresh", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
        });
        expect(nativeFetchAttempts).toBe(2);
        expect(adapter).not.toHaveBeenCalledWith(
            expect.objectContaining({ url: "/refresh-access-token" }),
        );
    });

    it("refreshes a revoked unexpired session and settles authority reset before redirect", async () => {
        let resolveReset: (() => void) | undefined;
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 401,
            headers: { get: () => null },
            json: async () => ({ error: "Unauthorized" }),
        } as unknown as Response));
        const adapter = jest.fn(async (config) => {
            throw new AxiosError(
                "Request failed with status code 401",
                "ERR_BAD_RESPONSE",
                config,
                undefined,
                {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {},
                    config,
                    data: { error: "Unauthorized" },
                },
            );
        });
        api.defaults.adapter = adapter;

        const location = { pathname: "/dashboard", href: "http://localhost/dashboard" };
        Object.defineProperty(window, "location", {
            configurable: true,
            value: location,
        });

        mockResetAuthorityState.mockImplementation((_client, options) => {
            if (options?.waitForCancellation === false) {
                return new Promise<void>((resolve) => {
                    resolveReset = resolve;
                });
            }
            return new Promise<void>(() => undefined);
        });

        const request = api.get("/clients");
        try {
            const pendingOutcome = await Promise.race([
                request.then(() => "resolved", () => "rejected"),
                new Promise<string>((resolve) => setTimeout(() => resolve("timed out"), 100)),
            ]);

            expect(pendingOutcome).toBe("timed out");
            expect(adapter).toHaveBeenCalledTimes(1);
            expect(mockResetAuthorityState).toHaveBeenCalledWith(
                undefined,
                { waitForCancellation: false },
            );
            expect(location.href).toBe("http://localhost/dashboard");

            resolveReset?.();
            await expect(request).rejects.toMatchObject({
                name: "ApplicationSessionRefreshError",
                status: 401,
            });
            expect(location.href).toBe("/login");
        } finally {
            resolveReset?.();
        }
    });

    it("recovers the application session and eformsign credential independently", async () => {
        let eformsignRequestAttempts = 0;
        global.fetch = jest.fn(async () => ({
            ok: true,
            status: 204,
            headers: { get: () => null },
            json: async () => null,
        } as unknown as Response));

        const adapter = jest.fn(async (config) => {
            if (config.url === "/refresh-access-token") {
                return {
                    config,
                    data: { success: true },
                    headers: {},
                    status: 200,
                    statusText: "OK",
                };
            }

            eformsignRequestAttempts += 1;
            if (eformsignRequestAttempts === 1) {
                throw new AxiosError(
                    "Application session expired",
                    "ERR_BAD_RESPONSE",
                    config,
                    undefined,
                    {
                        status: 401,
                        statusText: "Unauthorized",
                        headers: {},
                        config,
                        data: { code: "AUTH_REFRESH_REQUIRED" },
                    },
                );
            }
            if (eformsignRequestAttempts === 2) {
                throw new AxiosError(
                    "Eformsign credential expired",
                    "ERR_BAD_RESPONSE",
                    config,
                    undefined,
                    {
                        status: 401,
                        statusText: "Unauthorized",
                        headers: {},
                        config,
                        data: { code: "EFORMSIGN_TOKEN_EXPIRED" },
                    },
                );
            }

            return {
                config,
                data: { success: true },
                headers: {},
                status: 200,
                statusText: "OK",
            };
        });
        api.defaults.adapter = adapter;

        await expect(api.get("/eformsign-docs/client-names")).resolves.toMatchObject({
            data: { success: true },
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(eformsignRequestAttempts).toBe(3);
        expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
            url: "/refresh-access-token",
        }));
    });
});
