/** @jest-environment node */
import { NextRequest } from "next/server";
import { createProblemDetails } from "@babyjamjam/shared";
import { serverAPIClient } from "@/lib/api/server";
import { POST as keep } from "../client/[clientId]/period-mismatch/keep/route";
import { POST as fit } from "../client/[clientId]/period-mismatch/fit/route";

jest.mock("@/lib/api/server", () => ({ serverAPIClient: { post: jest.fn() } }));
const post = jest.mocked(serverAPIClient.post);
const params = { params: Promise.resolve({ clientId: "12" }) };
function request(body?: unknown, authenticated = true) {
    return new NextRequest("http://localhost/api/admin/service-records/client/12/period-mismatch/keep", {
        method: "POST",
        headers: { ...(authenticated ? { cookie: "auth_token=token-1" } : {}), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
}

beforeEach(() => post.mockReset());

it("posts only the validated unique indexes to the exact keep path with auth", async () => {
    const data = { keptSessionIndexes: [1, 3] };
    post.mockResolvedValue({ status: 200, data });
    const response = await keep(request({ sessionIndexes: [1, 3], extra: "ignored" }), params);
    expect(post).toHaveBeenCalledWith("/admin/service-records/client/12/period-mismatch/keep", { sessionIndexes: [1, 3] }, { headers: { Authorization: "Bearer token-1" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual(data);
});

it.each([undefined, {}, { ignored: true }, "malformed json"])("posts an empty fit body regardless of the input %j", async (body) => {
    const data = { startDate: "2026-10-30", endDate: "2026-11-19" };
    post.mockResolvedValue({ status: 200, data });
    const response = await fit(request(body), params);
    expect(post).toHaveBeenCalledWith("/admin/service-records/client/12/period-mismatch/fit", {}, { headers: { Authorization: "Bearer token-1" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual(data);
});

it.each([keep, fit])("requires authentication before proxying", async (handler) => {
    const response = await handler(request({}, false), params);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(post).not.toHaveBeenCalled();
});

it.each([keep, fit])("rejects an invalid client id before proxying", async (handler) => {
    const response = await handler(request({ sessionIndexes: [1] }), { params: Promise.resolve({ clientId: "nope" }) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED", errors: [expect.objectContaining({ pointer: "/clientId" })] });
    expect(post).not.toHaveBeenCalled();
});

it.each([{}, { sessionIndexes: [] }, { sessionIndexes: [1, 1] }, { sessionIndexes: [0] }, { sessionIndexes: [-1] }, { sessionIndexes: [1.5] }, { sessionIndexes: ["1"] }, { sessionIndexes: [null] }, { sessionIndexes: "1" }])("rejects invalid keep indexes %j", async (body) => {
    const response = await keep(request(body), params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED", errors: [expect.objectContaining({ pointer: "/sessionIndexes" })] });
    expect(post).not.toHaveBeenCalled();
});

it.each(["{", "[]", "null"])("rejects a malformed or nonobject keep body %s", async (body) => {
    const response = await keep(request(body), params);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(post).not.toHaveBeenCalled();
});

it.each([
    [keep, "VALIDATION_FAILED", 400], [keep, "RESOURCE_NOT_FOUND", 404],
    [fit, "REQUEST_CONFLICT", 409], [fit, "RESOURCE_NOT_FOUND", 404],
] as const)("preserves upstream %s %s problem details", async (handler, code, status) => {
    const problem = createProblemDetails({ code, requestId: "req-period", outcome: "NOT_APPLIED", ...(code === "VALIDATION_FAILED" ? { errors: [{ pointer: "/sessionIndexes", code: "INVALID_VALUE", detail: "입력값을 확인해 주세요.", location: "body" }] } : {}) });
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    try {
        post.mockRejectedValue({ response: { status, data: problem } });
        const response = await handler(request({ sessionIndexes: [1] }), params);
        expect(response.status).toBe(status);
        expect(response.headers.get("content-type")).toContain("application/problem+json");
        await expect(response.json()).resolves.toMatchObject({ code, requestId: "req-period", ...(code === "VALIDATION_FAILED" ? { errors: [expect.objectContaining({ pointer: "/sessionIndexes" })] } : {}) });
    } finally {
        log.mockRestore();
    }
});
