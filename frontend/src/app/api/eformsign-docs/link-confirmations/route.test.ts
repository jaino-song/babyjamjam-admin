/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

import { serverAPIClient } from "@/lib/api/server";

import { GET } from "./route";

jest.mock("@/lib/api/server", () => ({
    serverAPIClient: {
        get: jest.fn(),
    },
}));

const mockGet = serverAPIClient.get as jest.Mock;

function createRequest(query: string, authenticated = true): NextRequest {
    return new NextRequest(`http://localhost/api/eformsign-docs/link-confirmations${query}`, {
        headers: authenticated ? { cookie: "auth_token=token-1" } : {},
    });
}

describe("GET /api/eformsign-docs/link-confirmations", () => {
    beforeEach(() => {
        mockGet.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("forwards a numeric clientId to the backend and returns its body", async () => {
        const payload = [{ documentId: "doc-1", differences: ["name"] }];
        mockGet.mockResolvedValue({ data: payload });

        const response = await GET(createRequest("?clientId=7"));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual(payload);
        expect(mockGet).toHaveBeenCalledTimes(1);
        expect(mockGet).toHaveBeenCalledWith(
            "/eformsign-docs/link-confirmations",
            expect.objectContaining({ params: { clientId: "7" } }),
        );
    });

    it("rejects an unauthenticated read with a registered 401 problem body", async () => {
        const response = await GET(createRequest("?clientId=7", false));

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_REQUIRED", status: 401 });
        expect(mockGet).not.toHaveBeenCalled();
    });

    it("forwards a missing clientId without a query", async () => {
        mockGet.mockResolvedValue({ data: [] });
        const response = await GET(createRequest(""));

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([]);
        expect(mockGet).toHaveBeenCalledWith("/eformsign-docs/link-confirmations", {
            headers: expect.any(Object),
        });
        expect(mockGet.mock.calls[0][1]).not.toHaveProperty("params");
    });

    it("answers an empty clientId with a structured VALIDATION_FAILED problem", async () => {
        const response = await GET(createRequest("?clientId="));

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
        expect(body.errors).toMatchObject([{ pointer: "/clientId", code: "REQUIRED", location: "query" }]);
        expect(mockGet).not.toHaveBeenCalled();
    });

    it.each(["abc", "0", "-3", "1.5", "07", "1e3", " 7", "7 ", "7&x=1", "7,8"])(
        "rejects the non-numeric or non-positive clientId %p without calling the backend",
        async (value) => {
            const response = await GET(createRequest(`?clientId=${encodeURIComponent(value)}`));

            expect(response.status).toBe(400);
            const body = await response.json();
            expect(body).toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
            expect(body.errors).toMatchObject([{ pointer: "/clientId", location: "query" }]);
            expect(mockGet).not.toHaveBeenCalled();
        },
    );

    it("sanitizes an upstream failure instead of reflecting its message", async () => {
        mockGet.mockRejectedValue({
            response: { status: 500, data: { message: "link shard-9 exploded" } },
        });
        const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const response = await GET(createRequest("?clientId=7"));

            expect(response.status).toBe(500);
            const body = await response.json();
            expect(JSON.stringify(body)).not.toContain("shard-9");
        } finally {
            consoleErrorSpy.mockRestore();
        }
    });
});
