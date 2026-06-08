/**
 * @jest-environment node
 */
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
