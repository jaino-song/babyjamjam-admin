/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { DELETE, GET, PATCH } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        delete: jest.fn(),
        get: jest.fn(),
        patch: jest.fn(),
    },
}));

const mockDelete = serverAPIClient.delete as jest.Mock;
const mockGet = serverAPIClient.get as jest.Mock;
const mockPatch = serverAPIClient.patch as jest.Mock;

const params = { params: Promise.resolve({ id: "tpl-9" }) };

function request(method: string, body?: string, authenticated = true): NextRequest {
    return new NextRequest("http://localhost/api/message-templates/tpl-9", {
        method,
        headers: {
            ...(authenticated ? { cookie: "auth_token=token-1" } : {}),
            ...(body ? { "content-type": "application/json" } : {}),
        },
        body,
    });
}

describe("/api/message-templates/[id]", () => {
    beforeEach(() => {
        mockDelete.mockReset();
        mockGet.mockReset();
        mockPatch.mockReset();
    });

    it.each([
        ["GET", () => GET(request("GET", undefined, false), params)],
        ["PATCH", () => PATCH(request("PATCH", JSON.stringify({ name: "수정" }), false), params)],
        ["DELETE", () => DELETE(request("DELETE", undefined, false), params)],
    ])("rejects an unauthenticated %s with a registered 401 problem body", async (_method, invoke) => {
        const response = await invoke();

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED" });
        expect(mockGet).not.toHaveBeenCalled();
        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
    });

    it("sanitizes a legacy upstream failure on GET instead of a raw English 500", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "template row locked on shard-2" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        const response = await GET(request("GET"), params);

        expect(response.status).toBe(500);
        const body = await response.json();
        expect(JSON.stringify(body)).not.toContain("shard-2");
        expect(JSON.stringify(body)).not.toContain("Failed to fetch message template");
        consoleErrorSpy.mockRestore();
    });

    it("keeps a successful delete bodyless on 204", async () => {
        mockDelete.mockResolvedValue({ status: 204, data: undefined });

        const response = await DELETE(request("DELETE"), params);

        expect(response.status).toBe(204);
    });
});
