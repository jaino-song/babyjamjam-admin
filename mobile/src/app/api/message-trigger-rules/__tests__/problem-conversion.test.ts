/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { DELETE as deleteRule, GET as getRule, PATCH as patchRule } from "../[triggerId]/route";
import { PUT as putBranchActivation } from "../[triggerId]/branch-activation/route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
        patch: jest.fn(),
        delete: jest.fn(),
        put: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;
const mockDelete = serverAPIClient.delete as jest.Mock;
const mockPut = serverAPIClient.put as jest.Mock;

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

const ruleParams = { params: Promise.resolve({ triggerId: "rule:1" }) };

async function expectTriggerIdProblem(response: Response): Promise<void> {
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/problem+json");
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
        code: "VALIDATION_FAILED",
        status: 400,
        outcome: "NOT_APPLIED",
        error: "Invalid trigger id",
        errors: [{ pointer: "/triggerId", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" }],
    }));
}

describe("message-trigger-rules BFF problem conversion (BJJ-319 6h2)", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        mockGet.mockReset();
        mockPatch.mockReset();
        mockDelete.mockReset();
        mockPut.mockReset();
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it.each([
        ["GET", () => getRule(request("/api/message-trigger-rules/rule:1", { cookie: false }), ruleParams)],
        ["PATCH", () => patchRule(request("/api/message-trigger-rules/rule:1", { method: "PATCH", cookie: false, body: "{}" }), ruleParams)],
        ["DELETE", () => deleteRule(request("/api/message-trigger-rules/rule:1", { method: "DELETE", cookie: false }), ruleParams)],
        ["branch-activation PUT", () => putBranchActivation(request("/api/message-trigger-rules/rule:1/branch-activation", { method: "PUT", cookie: false, body: "{}" }), ruleParams)],
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

    it.each([
        ["GET", () => getRule(request("/api/message-trigger-rules/bad id"), { params: Promise.resolve({ triggerId: "bad id" }) })],
        ["PATCH", () => patchRule(request("/api/message-trigger-rules/bad id", { method: "PATCH", body: "{}" }), { params: Promise.resolve({ triggerId: "bad id" }) })],
        ["DELETE", () => deleteRule(request("/api/message-trigger-rules/bad id", { method: "DELETE" }), { params: Promise.resolve({ triggerId: "bad id" }) })],
        ["branch-activation PUT", () => putBranchActivation(request("/api/message-trigger-rules/bad id/branch-activation", { method: "PUT", body: "{}" }), { params: Promise.resolve({ triggerId: "bad id" }) })],
    ])("rejects a malformed trigger id with a VALIDATION_FAILED path problem for %s", async (_method, act) => {
        const response = await act();

        await expectTriggerIdProblem(response);
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockPut).not.toHaveBeenCalled();
    });

    it("keeps the GET success passthrough", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { id: "rule:1" } });

        const response = await getRule(request("/api/message-trigger-rules/rule:1"), ruleParams);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: "rule:1" });
    });
});
