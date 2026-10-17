/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";
import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: { get: jest.fn() },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(search: string, cookie = "auth_token=auth-token"): NextRequest {
    return new NextRequest(`http://localhost/api/employees/id${search}`, {
        headers: cookie ? { cookie } : {},
    });
}

describe("GET /api/employees/id", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    it("forwards a valid id to the backend by-id endpoint with the caller's token", async () => {
        mockGet.mockResolvedValue({ status: 200, data: { id: 12, name: "박도우미", phone: "01099998888" } });

        const response = await GET(createRequest("?id=12"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ id: 12, name: "박도우미", phone: "01099998888" });
        expect(mockGet).toHaveBeenCalledTimes(1);
        const [path, config] = mockGet.mock.calls[0];
        expect(path).toBe("/employees/id");
        expect(config.params).toEqual({ id: "12" });
        expect(config.headers.Authorization).toBe("Bearer auth-token");
    });

    it.each([
        ["a missing id", ""],
        ["id 0", "?id=0"],
        ["a non-numeric id", "?id=abc"],
        ["a negative id", "?id=-1"],
        ["a decimal id", "?id=1.5"],
    ])("rejects %s locally without calling the backend", async (_label, search) => {
        const response = await GET(createRequest(search));

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: "Invalid employee id" });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("rejects a missing auth token with the shared 401 response", async () => {
        const response = await GET(createRequest("?id=12", ""));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("passes an empty backend body (unknown or other-branch employee) through as a 200 non-record", async () => {
        mockGet.mockResolvedValue({ status: 200, data: "" });

        const response = await GET(createRequest("?id=12"));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body === "" || body === null).toBe(true);
    });

    it("maps an upstream failure through the shared sanitizer with the status preserved", async () => {
        mockGet.mockRejectedValue({ response: { status: 403, data: { error: "denied" } } });

        const response = await GET(createRequest("?id=12"));

        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.error).toBeTruthy();
    });
});
