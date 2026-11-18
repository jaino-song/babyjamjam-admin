/**
 * @jest-environment node
 */
import { AxiosError } from "axios";

const mockScope = {
    setLevel: jest.fn(), setTag: jest.fn(), setContext: jest.fn(), setFingerprint: jest.fn(),
};
const mockCaptureException = jest.fn();
const mockFlush = jest.fn().mockResolvedValue(true);

jest.mock("@sentry/nextjs", () => ({
    withScope: (callback: (scope: typeof mockScope) => void) => callback(mockScope),
    captureException: (error: unknown) => mockCaptureException(error),
    flush: (timeout: number) => mockFlush(timeout),
}));

import { resolveBackendBaseUrl, serverAPIClient } from "../server";

type BackendEnv = Parameters<typeof resolveBackendBaseUrl>[0];

function createEnv(overrides: Partial<BackendEnv> = {}): BackendEnv {
    return {
        NODE_ENV: "development",
        VERCEL_ENV: undefined,
        NEXT_PUBLIC_API_BASE_URL: undefined,
        DEVELOPMENT_API_BASE_URL: undefined,
        ...overrides,
    };
}

describe("resolveBackendBaseUrl", () => {
    it("uses local backend fallback outside production-like environments", () => {
        expect(resolveBackendBaseUrl(createEnv())).toBe("http://localhost:3001");
    });

    it("requires NEXT_PUBLIC_API_BASE_URL in production", () => {
        expect(() => resolveBackendBaseUrl(createEnv({
            NODE_ENV: "production",
            DEVELOPMENT_API_BASE_URL: "http://localhost:3001",
        }))).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
    });

    it("requires NEXT_PUBLIC_API_BASE_URL on Vercel preview", () => {
        expect(() => resolveBackendBaseUrl(createEnv({
            VERCEL_ENV: "preview",
            DEVELOPMENT_API_BASE_URL: "http://localhost:3001",
        }))).toThrow(/NEXT_PUBLIC_API_BASE_URL/);
    });

    it("normalizes valid backend URLs", () => {
        expect(resolveBackendBaseUrl(createEnv({
            NODE_ENV: "production",
            NEXT_PUBLIC_API_BASE_URL: "https://api.example.com/",
        }))).toBe("https://api.example.com");
    });

    it("rejects invalid URL schemes", () => {
        expect(() => resolveBackendBaseUrl(createEnv({
            NODE_ENV: "production",
            NEXT_PUBLIC_API_BASE_URL: "ftp://api.example.com",
        }))).toThrow(/http:\/\/ or https:\/\//);
    });
});

describe("serverAPIClient", () => {
    it("rejects backend error statuses so API routes preserve upstream failures", () => {
        const validateStatus = serverAPIClient.defaults.validateStatus;

        expect(validateStatus?.(200)).toBe(true);
        expect(validateStatus?.(399)).toBe(true);
        expect(validateStatus?.(400)).toBe(false);
        expect(validateStatus?.(500)).toBe(false);
    });
});


describe("server API error monitoring", () => {
    const originalAdapter = serverAPIClient.defaults.adapter;

    afterEach(() => {
        serverAPIClient.defaults.adapter = originalAdapter;
        jest.clearAllMocks();
    });

    it("captures and flushes a non-service-record 502 before propagating the original error", async () => {
        let failure: AxiosError | undefined;
        serverAPIClient.defaults.adapter = async (config) => {
            failure = new AxiosError("upstream failed", "ERR_BAD_RESPONSE", config, undefined, {
                status: 502, statusText: "Bad Gateway", headers: {}, config, data: { private: "response body" },
            });
            throw failure;
        };
        const caught = await serverAPIClient.get("/clients/123?token=private").catch((error: unknown) => error);
        expect(caught).toBe(failure);
        expect(mockCaptureException).toHaveBeenCalledTimes(1);
        expect(mockCaptureException).toHaveBeenCalledWith(expect.objectContaining({ name: "ApiRequestError" }));
        expect(mockScope.setContext).toHaveBeenCalledWith("api", {
            method: "GET", path: "/clients/:id", status: 502, code: "ERR_BAD_RESPONSE", runtime: "server",
        });
        expect(mockFlush).toHaveBeenCalledTimes(1);
        expect(mockFlush).toHaveBeenCalledWith(2_000);
        expect(mockCaptureException.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]);
    });
});
