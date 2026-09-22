/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { DELETE as deleteTemplate, GET as getTemplate, PATCH as patchTemplate } from "../route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockDelete = serverAPIClient.delete as jest.Mock;

function request(path: string, init: { method?: string; cookie?: boolean; body?: string } = {}): NextRequest {
    return new NextRequest(`http://localhost${path}`, {
        method: init.method ?? "GET",
        headers: {
            ...(init.cookie === false ? {} : { cookie: "auth_token=auth-token" }),
            ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
    });
}

const templateParams = { params: Promise.resolve({ id: "template-1" }) };

describe("message-templates/[id] BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPatch.mockReset();
        mockDelete.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["GET", () => getTemplate(request("/api/message-templates/template-1", { cookie: false }), templateParams)],
        ["PATCH", () => patchTemplate(request("/api/message-templates/template-1", { method: "PATCH", cookie: false, body: "{}" }), templateParams)],
        ["DELETE", () => deleteTemplate(request("/api/message-templates/template-1", { method: "DELETE", cookie: false }), templateParams)],
    ])("returns an AUTH_REQUIRED problem for %s without a token", async (_method, act) => {
        const response = await act();

        expect(response.status).toBe(401);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "AUTH_REQUIRED",
            status: 401,
            outcome: "NOT_APPLIED",
        }));
    });

    it("rejects a malformed template id with a VALIDATION_FAILED path problem", async () => {
        const response = await patchTemplate(
            request("/api/message-templates/bad%2Fid", { method: "PATCH", body: "{}" }),
            { params: Promise.resolve({ id: "bad/id" }) },
        );

        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toBe("application/problem+json");
        await expect(response.json()).resolves.toEqual(expect.objectContaining({
            code: "VALIDATION_FAILED",
            status: 400,
            outcome: "NOT_APPLIED",
            error: "Invalid message template id",
            errors: [{ pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" }],
        }));
        expect(mockPatch).not.toHaveBeenCalled();
    });

    it("keeps the GET success passthrough", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { id: "template-1" } });

        const response = await getTemplate(request("/api/message-templates/template-1"), templateParams);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: "template-1" });
    });
});
