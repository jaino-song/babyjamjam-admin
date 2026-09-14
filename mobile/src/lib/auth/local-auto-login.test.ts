/** @jest-environment node */
import { NextRequest } from "next/server";

import { tryLocalAutoLogin } from "./local-auto-login";

const originalEnv = process.env;
const originalFetch = global.fetch;
const fetchMock = jest.fn();

function request(
    url = "http://localhost:3002/dashboard",
    headers: Record<string, string> = {},
): NextRequest {
    return new NextRequest(url, {
        headers: { host: new URL(url).host, ...headers },
    });
}

beforeEach(() => {
    process.env = {
        NODE_ENV: "development",
        LOCAL_AUTO_LOGIN_EMAIL: "developer@example.test",
        LOCAL_AUTO_LOGIN_PASSWORD: "test-fixture",
    };
    global.fetch = fetchMock;
    fetchMock.mockReset().mockResolvedValue({
        ok: true,
        json: async () => ({
            success: true,
            accessToken: "access",
            refreshToken: "refresh",
        }),
    });
});

afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
});

it("creates a normal session through the configured loopback backend", async () => {
    await expect(
        tryLocalAutoLogin(request(), "http://localhost:3001"),
    ).resolves.toEqual({ accessToken: "access", refreshToken: "refresh" });
    expect(fetchMock).toHaveBeenCalledWith(
        new URL("http://localhost:3001/auth/login"),
        expect.objectContaining({
            method: "POST",
            redirect: "error",
            cache: "no-store",
            body: JSON.stringify({
                email: "developer@example.test",
                password: "test-fixture",
            }),
        }),
    );
});

it.each(["production", "test", "preview", ""])(
    "rejects runtime %s",
    async (runtime) => {
        Object.defineProperty(process.env, "NODE_ENV", {
            value: runtime,
            configurable: true,
        });
        await expect(
            tryLocalAutoLogin(request(), "http://localhost:3001"),
        ).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    },
);

it.each([
    "VERCEL",
    "VERCEL_ENV",
    "RAILWAY_ENVIRONMENT_ID",
    "RAILWAY_ENVIRONMENT_NAME",
])("rejects deployment marker %s", async (key) => {
    process.env[key] = "dev";
    await expect(
        tryLocalAutoLogin(request(), "http://localhost:3001"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
    "https://mobile.example.test",
    "http://192.168.1.2:3002",
    "http://localhost.example.test",
])("rejects frontend %s", async (url) => {
    await expect(
        tryLocalAutoLogin(request(url), "http://localhost:3001"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
    "https://api.example.test",
    "http://192.168.1.2:3001",
    "not-a-url",
])("rejects backend %s", async (backendUrl) => {
    await expect(
        tryLocalAutoLogin(request(), backendUrl),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
});

it.each<Record<string, string>>([
    { host: "attacker.test" },
    { "x-forwarded-host": "attacker.test" },
    { origin: "http://attacker.test" },
    { "sec-fetch-site": "cross-site" },
    { cookie: "auth_token=existing" },
    { cookie: "refresh_token=existing" },
])("rejects unsafe or already authenticated request %j", async (headers) => {
    await expect(
        tryLocalAutoLogin(request(undefined, headers), "http://localhost:3001"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
});

it("does not submit missing credentials or POST navigation", async () => {
    delete process.env.LOCAL_AUTO_LOGIN_PASSWORD;
    await expect(
        tryLocalAutoLogin(request(), "http://localhost:3001"),
    ).resolves.toBeNull();
    await expect(
        tryLocalAutoLogin(
            new NextRequest("http://localhost:3002", { method: "POST" }),
            "http://localhost:3001",
        ),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
    { ok: false },
    { ok: true, json: async () => ({ success: true }) },
])("fails closed on rejected or malformed login", async (response) => {
    fetchMock.mockResolvedValue(response);
    await expect(
        tryLocalAutoLogin(request(), "http://localhost:3001"),
    ).resolves.toBeNull();
});

it("does not log credential-bearing network errors", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("request failed"));
    await expect(
        tryLocalAutoLogin(request(), "http://localhost:3001"),
    ).resolves.toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
});

it("accepts a normalized loopback URL while preserving the incoming host", async () => {
    await expect(
        tryLocalAutoLogin(
            request(undefined, {
                host: "127.0.0.1:3002",
                "x-forwarded-host": "127.0.0.1:3002",
            }),
            "http://localhost:3001",
        ),
    ).resolves.not.toBeNull();
});

it("rejects a mismatched loopback port", async () => {
    await expect(
        tryLocalAutoLogin(
            request(undefined, { host: "127.0.0.1:4000" }),
            "http://localhost:3001",
        ),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
});
