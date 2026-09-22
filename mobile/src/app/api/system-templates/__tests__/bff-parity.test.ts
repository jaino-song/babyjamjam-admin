/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET as getTemplate, PUT as updateTemplate } from "../[key]/route";
import { POST as previewTemplate } from "../[key]/preview/route";
import { POST as validateTemplate } from "../[key]/validate/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPost = serverAPIClient.post as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

function createRequest(
    path: string,
    method: string,
    body?: BodyInit,
    cookie = "auth_token=token-1",
): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method,
        headers: {
            ...(cookie ? { cookie } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body,
    });
}

const keyParams = { params: Promise.resolve({ key: "SERVICE_END_NOTICE" }) };

describe("mobile system-template BFF parity contract", () => {
    beforeEach(() => {
        mockGet.mockReset();
        mockPost.mockReset();
        mockPut.mockReset();
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        [getTemplate, "GET"],
        [updateTemplate, "PUT"],
        [validateTemplate, "POST"],
        [previewTemplate, "POST"],
    ])("returns the same 401 before touching upstream for %s", async (handler, method) => {
        const response = await handler(
            createRequest("/api/system-templates/SERVICE_END_NOTICE", method, undefined, ""),
            keyParams,
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
            error: "Unauthorized",
        }));
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPost).not.toHaveBeenCalled();
        expect(mockPut).not.toHaveBeenCalled();
    });

    it.each([
        [validateTemplate, "/validate", "{bad-json"],
        [previewTemplate, "/preview", "{bad-json"],
    ])("returns a shared 400 for malformed JSON on %s", async (handler, suffix, body) => {
        const response = await handler(
            createRequest(`/api/system-templates/SERVICE_END_NOTICE${suffix}`, "POST", body),
            keyParams,
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            outcome: "NOT_APPLIED",
            error: "Request body must be valid JSON",
        }));
        expect(mockPost).not.toHaveBeenCalled();
    });

    it.each([
        [updateTemplate, "PUT", JSON.stringify({ customVariables: [] })],
        [validateTemplate, "POST", JSON.stringify({})],
        [previewTemplate, "POST", JSON.stringify({ content: "hello" })],
    ])("returns a shared 400 for invalid %s body fields", async (handler, method, body) => {
        const response = await handler(
            createRequest("/api/system-templates/SERVICE_END_NOTICE", method, body),
            keyParams,
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ error: "Invalid request body" });
        expect(mockPost).not.toHaveBeenCalled();
        expect(mockPut).not.toHaveBeenCalled();
    });

    it("rejects a multi-segment or unknown key before upstream access", async () => {
        const response = await previewTemplate(
            createRequest("/api/system-templates/GREETING%2Fpreview/preview", "POST", JSON.stringify({ data: {} })),
            { params: Promise.resolve({ key: "GREETING/preview" }) },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "Invalid system template key" });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it("preserves the literal single-key path while encoding it through the shared helper", async () => {
        mockPost.mockResolvedValue({ status: 200, data: "rendered" });

        const response = await previewTemplate(
            createRequest(
                "/api/system-templates/SERVICE_END_NOTICE/preview",
                "POST",
                JSON.stringify({ content: "Hi {{name}}", data: { name: "Mina" } }),
            ),
            keyParams,
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toBe("rendered");
        expect(mockPost).toHaveBeenCalledWith(
            "/system-templates/SERVICE_END_NOTICE/preview",
            { content: "Hi {{name}}", data: { name: "Mina" } },
            { headers: { Authorization: "Bearer token-1" } },
        );
    });

    it.each([400, 403, 409, 422])("sanitizes upstream %i preview errors identically", async (status) => {
        mockPost.mockRejectedValue({
            response: {
                status,
                data: {
                    message: "Bearer upstream-secret",
                    diagnostics: "SELECT * FROM system_templates",
                },
            },
        });

        const response = await previewTemplate(
            createRequest(
                "/api/system-templates/SERVICE_END_NOTICE/preview",
                "POST",
                JSON.stringify({ data: {} }),
            ),
            keyParams,
        );

        expect(response.status).toBe(status);
        const body = await response.json();
        expect(typeof body.error).toBe("string");
        expect(body.error).toMatch(/[가-힣]/);
        expect(body.code).not.toBe("UPSTREAM_ERROR");
        expect(JSON.stringify(body)).not.toContain("upstream-secret");
        expect(JSON.stringify(body)).not.toContain("SELECT");
    });
});
